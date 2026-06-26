import type { LocalAudioTrack, RemoteAudioTrack, RemoteTrack } from "livekit-client";
import { createLocalAudioTrack, Room, RoomEvent, Track } from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { client } from "@/client/client.gen";
import { getTurnCredentialsApiV1TurnCredentialsGet, validateUserConfigurationsApiV1UserConfigurationsUserValidateGet, validateWorkflowApiV1WorkflowWorkflowIdValidatePost } from "@/client/sdk.gen";
import { TurnCredentialsResponse } from "@/client/types.gen";
import { WorkflowValidationError } from "@/components/flow/types";
import type { ConversationNodeTransitionItem, RealtimeFeedbackMessage as FeedbackMessage } from "@/components/workflow/conversation";
import { useAppConfig } from "@/context/AppConfigContext";
import { getAudioCaptureUnsupportedMessage } from "@/lib/browserMedia";
import logger from '@/lib/logger';

import { sdpFilterCodec } from "../utils";
import { useDeviceInputs } from "./useDeviceInputs";

const LIVEKIT_FEEDBACK_TOPIC = "spx-voice.feedback";

interface UseWebSocketRTCProps {
    workflowId: number;
    workflowRunId: number;
    accessToken: string | null;
    initialContextVariables?: Record<string, string> | null;
    onNodeTransition?: (transition: ConversationNodeTransitionItem) => void;
}

export const useWebSocketRTC = ({ workflowId, workflowRunId, accessToken, initialContextVariables, onNodeTransition }: UseWebSocketRTCProps) => {
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'failed'>('idle');
    const [connectionActive, setConnectionActive] = useState(false);
    const [isCompleted, setIsCompleted] = useState(false);
    const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);
    const [apiKeyErrorCode, setApiKeyErrorCode] = useState<string | null>(null);
    const [workflowConfigModalOpen, setWorkflowConfigModalOpen] = useState(false);
    const [workflowConfigError, setWorkflowConfigError] = useState<string | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    const [feedbackMessages, setFeedbackMessages] = useState<FeedbackMessage[]>([]);
    const initialContext = initialContextVariables || {};
    const { config: appConfig, loading: appConfigLoading } = useAppConfig();

    const {
        audioInputs,
        selectedAudioInput,
        setSelectedAudioInput,
        permissionError,
        setPermissionError,
        getAudioInputDevices
    } = useDeviceInputs();

    const useStun = true;
    const useAudio = true;
    const audioCodec = 'default';

    // TURN server credentials fetched at runtime from backend API
    // Uses time-limited credentials (TURN REST API) for security
    const turnCredentialsRef = useRef<TurnCredentialsResponse | null>(null);

    const audioRef = useRef<HTMLAudioElement>(null);
    const pcRef = useRef<RTCPeerConnection | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const liveKitRoomRef = useRef<Room | null>(null);
    const liveKitLocalTrackRef = useRef<LocalAudioTrack | null>(null);
    const liveKitRemoteAudioTracksRef = useRef<RemoteAudioTrack[]>([]);
    const liveKitIntentionalDisconnectRef = useRef(false);
    const timeStartRef = useRef<number | null>(null);
    const onNodeTransitionRef = useRef(onNodeTransition);
    const feedbackMessageCounterRef = useRef(0);

    useEffect(() => {
        onNodeTransitionRef.current = onNodeTransition;
    }, [onNodeTransition]);

    const nextFeedbackMessageId = useCallback((prefix: string) => {
        feedbackMessageCounterRef.current += 1;
        return `${prefix}-${Date.now()}-${feedbackMessageCounterRef.current}`;
    }, []);

    // Generate a cryptographically secure unique ID
    const generateSecureId = () => {
        // Use Web Crypto API to generate random bytes
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        // Convert to hex string
        return 'PC-' + Array.from(array)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    };

    const pc_id = useRef(generateSecureId());

    // Mute/speaking state tracking refs (ephemeral signals, not rendered directly)
    const userMutedRef = useRef(false);
    const firstBotSpeechCompletedRef = useRef(false);
    const currentAllowInterruptRef = useRef<boolean | undefined>(undefined);
    const interruptWarningShownRef = useRef(false);

    // Get WebSocket URL from client configuration
    const getWebSocketUrl = useCallback(() => {
        // Get base URL from client configuration
        const baseUrl = client.getConfig().baseUrl || 'http://127.0.0.1:8000';
        // Convert HTTP to WS protocol
        const wsUrl = baseUrl.replace(/^http/, 'ws');
        return `${wsUrl}/api/v1/ws/signaling/${workflowId}/${workflowRunId}?token=${accessToken}`;
    }, [workflowId, workflowRunId, accessToken]);

    const disconnectLiveKit = useCallback(async (markCompleted = true) => {
        liveKitIntentionalDisconnectRef.current = true;
        setConnectionActive(false);
        if (markCompleted) {
            setIsCompleted(true);
            setConnectionStatus('idle');
        }

        liveKitRemoteAudioTracksRef.current.forEach(track => {
            try {
                track.detach();
            } catch (error) {
                logger.debug('Failed to detach LiveKit audio track:', error);
            }
        });
        liveKitRemoteAudioTracksRef.current = [];

        if (liveKitLocalTrackRef.current) {
            try {
                liveKitLocalTrackRef.current.stop();
            } catch (error) {
                logger.debug('Failed to stop LiveKit local audio track:', error);
            }
            liveKitLocalTrackRef.current = null;
        }

        const room = liveKitRoomRef.current;
        liveKitRoomRef.current = null;
        if (room) {
            try {
                await room.disconnect(true);
            } catch (error) {
                logger.debug('Failed to disconnect LiveKit room:', error);
            }
        }
    }, []);

    const attachLiveKitAudio = useCallback((track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio || !audioRef.current) {
            return;
        }
        const audioTrack = track as RemoteAudioTrack;
        audioTrack.attach(audioRef.current);
        liveKitRemoteAudioTracksRef.current = [
            ...liveKitRemoteAudioTracksRef.current.filter(existing => existing.sid !== audioTrack.sid),
            audioTrack,
        ];
        void audioRef.current.play().catch(error => {
            logger.debug('LiveKit audio autoplay was blocked:', error);
            setPermissionError('Browser blocked audio playback. Click Retry Call or Start Test again to unlock audio.');
        });
    }, []);

    const unlockBrowserAudioPlayback = useCallback(async () => {
        const audioElement = audioRef.current;
        if (audioElement) {
            audioElement.muted = false;
            audioElement.autoplay = true;
            try {
                await audioElement.play();
            } catch (error) {
                logger.debug('Initial audio element unlock did not complete:', error);
            }
        }

        const AudioContextConstructor =
            window.AudioContext ||
            (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextConstructor) {
            return;
        }

        try {
            const audioContext = new AudioContextConstructor();
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            await audioContext.close();
        } catch (error) {
            logger.debug('Browser audio context unlock failed:', error);
        }
    }, []);

    const handleLiveKitFeedbackMessage = useCallback((message: { type?: string; payload?: Record<string, unknown> }) => {
        switch (message.type) {
            case 'rtf-user-transcription': {
                const transcription = message.payload ?? {};

                if (
                    !interruptWarningShownRef.current &&
                    firstBotSpeechCompletedRef.current &&
                    userMutedRef.current &&
                    currentAllowInterruptRef.current === false
                ) {
                    const warningId = nextFeedbackMessageId('interrupt-warning');
                    interruptWarningShownRef.current = true;
                    setFeedbackMessages(prev => [...prev, {
                        id: warningId,
                        type: 'interrupt-warning',
                        text: 'Interruption is disabled for this step. The bot will finish speaking before processing your input. You can enable interruption in the workflow editor.',
                        timestamp: new Date().toISOString(),
                    }]);
                }

                const transcriptionId = nextFeedbackMessageId('user');
                const final = Boolean(transcription.final);
                setFeedbackMessages(prev => {
                    const messagesWithBotFinalized = prev.map((msg, idx) => {
                        const isLastMessage = idx === prev.length - 1;
                        const isUnfinalizedBotMessage = msg.type === 'bot-text' && !msg.final;
                        return isLastMessage && isUnfinalizedBotMessage
                            ? { ...msg, final: true }
                            : msg;
                    });
                    const messagesWithoutInterim = messagesWithBotFinalized.filter(
                        msg => !(msg.type === 'user-transcription' && !msg.final)
                    );
                    return [...messagesWithoutInterim, {
                        id: transcriptionId,
                        type: 'user-transcription',
                        text: String(transcription.text ?? ''),
                        final,
                        timestamp: new Date().toISOString(),
                    }];
                });
                break;
            }

            case 'rtf-bot-text': {
                const botMessageId = nextFeedbackMessageId('bot');
                setFeedbackMessages(prev => [...prev, {
                    id: botMessageId,
                    type: 'bot-text',
                    text: String(message.payload?.text ?? ''),
                    final: true,
                    timestamp: new Date().toISOString(),
                }]);
                firstBotSpeechCompletedRef.current = true;
                break;
            }

            case 'rtf-function-call-end': {
                const toolCallId = String(message.payload?.tool_call_id ?? '');
                const result = message.payload?.result;
                setFeedbackMessages(prev => {
                    const existingId = `func-${toolCallId}`;
                    if (prev.some(msg => msg.id === existingId)) {
                        return prev.map(msg =>
                            msg.id === existingId
                                ? { ...msg, status: 'completed' as const, text: String(result ?? msg.text), result }
                                : msg
                        );
                    }
                    return [...prev, {
                        id: existingId || nextFeedbackMessageId('func'),
                        type: 'function-call',
                        text: String(result ?? message.payload?.function_name ?? 'tool'),
                        functionName: String(message.payload?.function_name ?? 'tool'),
                        toolCallId,
                        status: 'completed',
                        result,
                        timestamp: new Date().toISOString(),
                    }];
                });
                break;
            }

            case 'rtf-node-transition': {
                const payload = message.payload ?? {};
                const allowInterrupt = payload.allow_interrupt as boolean | undefined;
                currentAllowInterruptRef.current = allowInterrupt;
                const transitionTimestamp = new Date().toISOString();
                const transition: ConversationNodeTransitionItem = {
                    kind: 'node-transition',
                    id: nextFeedbackMessageId('node'),
                    timestamp: transitionTimestamp,
                    nodeId: String(payload.node_id ?? ''),
                    nodeName: String(payload.node_name ?? 'Node'),
                    previousNodeId: payload.previous_node_id as string | undefined,
                    previousNodeName: payload.previous_node_name as string | undefined,
                    allowInterrupt,
                };
                setFeedbackMessages(prev => [...prev, {
                    id: transition.id,
                    type: 'node-transition',
                    text: transition.nodeName,
                    nodeId: transition.nodeId,
                    nodeName: transition.nodeName,
                    previousNodeId: transition.previousNodeId,
                    previousNode: transition.previousNodeName,
                    allowInterrupt,
                    timestamp: transitionTimestamp,
                }]);
                onNodeTransitionRef.current?.(transition);
                break;
            }

            case 'rtf-pipeline-error': {
                const payload = message.payload ?? {};
                setFeedbackMessages(prev => [...prev, {
                    id: nextFeedbackMessageId('error'),
                    type: 'pipeline-error',
                    text: String(payload.error ?? 'LiveKit runtime error'),
                    fatal: Boolean(payload.fatal),
                    processor: payload.processor as string | undefined,
                    timestamp: new Date().toISOString(),
                }]);
                break;
            }

            case 'rtf-run-completed':
                setFeedbackMessages(prev => {
                    const lastIdx = prev.length - 1;
                    const last = prev[lastIdx];
                    if (last && last.type === 'bot-text' && !last.final) {
                        const updated = [...prev];
                        updated[lastIdx] = { ...last, final: true };
                        return updated;
                    }
                    return prev;
                });
                void disconnectLiveKit(true);
                break;

            default:
                logger.warn('Unknown LiveKit feedback message type:', message.type);
        }
    }, [disconnectLiveKit, nextFeedbackMessageId]);

    const createPeerConnection = () => {
        // Build ICE servers list
        const iceServers: RTCIceServer[] = [];

        if (useStun) {
            iceServers.push({ urls: ['stun:stun.l.google.com:19302'] });
        }

        // Add TURN server if credentials are available (time-limited credentials from backend)
        const turnCredentials = turnCredentialsRef.current;
        if (turnCredentials?.uris && turnCredentials.uris.length > 0) {
            iceServers.push({
                urls: turnCredentials.uris,
                username: turnCredentials.username,
                credential: turnCredentials.password
            });

            logger.info(`TURN server configured with ${turnCredentials.uris.length} URIs, TTL: ${turnCredentials.ttl}s`);
        }

        const config: RTCConfiguration = {
            iceServers
        };

        // Diagnostic: when the backend is started with FORCE_TURN_RELAY=true,
        // restrict the browser to relay-only candidates so media must traverse
        // TURN. Lets you verify TURN connectivity end-to-end — a TURN
        // misconfiguration surfaces as an ICE failure instead of silently
        // falling back to host/srflx.
        if (appConfig?.forceTurnRelay) {
            config.iceTransportPolicy = 'relay';
            logger.info('FORCE_TURN_RELAY is on — restricting browser ICE to relay candidates only');
        }

        const pc = new RTCPeerConnection(config);

        // Set up ICE candidate trickling
        pc.addEventListener('icecandidate', (event) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'ice-candidate',
                    payload: {
                        candidate: event.candidate ? {
                            candidate: event.candidate.candidate,
                            sdpMid: event.candidate.sdpMid,
                            sdpMLineIndex: event.candidate.sdpMLineIndex
                        } : null,
                        pc_id: pc_id.current
                    }
                };
                wsRef.current.send(JSON.stringify(message));

                if (event.candidate) {
                    logger.debug(`Sending ICE candidate: ${event.candidate.candidate}`);
                } else {
                    logger.debug('Sending end-of-candidates signal');
                }
            }
        });

        pc.addEventListener('iceconnectionstatechange', () => {
            logger.info(`ICE connection state changed: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                setConnectionStatus('connected');
            } else if (pc.iceConnectionState === 'failed') {
                setConnectionStatus('failed');
            } else if (pc.iceConnectionState === 'disconnected') {
                // Server-initiated disconnect - clean up gracefully
                logger.info('Server initiated disconnect - cleaning up connection');

                // Close WebSocket if still open
                if (wsRef.current) {
                    wsRef.current.close();
                    wsRef.current = null;
                }

                // Mark as completed to trigger recording check
                setConnectionActive(false);
                setIsCompleted(true);
                setConnectionStatus('idle');

                // Clean up peer connection
                if (pc.getTransceivers) {
                    pc.getTransceivers().forEach((transceiver) => {
                        if (transceiver.stop) {
                            transceiver.stop();
                        }
                    });
                }

                pc.getSenders().forEach((sender) => {
                    if (sender.track) {
                        sender.track.stop();
                    }
                });
            }
        });

        pc.addEventListener('track', (evt) => {
            if (evt.track.kind === 'audio' && audioRef.current) {
                audioRef.current.srcObject = evt.streams[0];
            }
        });

        pcRef.current = pc;
        return pc;
    };

    const connectWebSocket = useCallback(() => {
        return new Promise<void>((resolve, reject) => {
            const wsUrl = getWebSocketUrl();
            logger.info(`Connecting to WebSocket: ${wsUrl}`);

            const ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                logger.info('WebSocket connected');
                wsRef.current = ws;
                resolve();
            };

            ws.onerror = (error) => {
                logger.error('WebSocket error:', error);
                reject(error);
            };

            ws.onclose = () => {
                logger.info('WebSocket closed');
                wsRef.current = null;
                // Don't set failed status if already completed (graceful disconnect)
                if (connectionActive && !isCompleted) {
                    setConnectionStatus('failed');
                }
            };

            ws.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data);

                    switch (message.type) {
                        case 'answer':
                            // Set remote description immediately (may have no candidates)
                            const answer = message.payload;
                            logger.debug('Received answer from server');

                            if (pcRef.current) {
                                await pcRef.current.setRemoteDescription({
                                    type: 'answer',
                                    sdp: answer.sdp
                                });
                                setConnectionActive(true);
                                logger.info('Remote description set');
                            }
                            break;

                        case 'ice-candidate':
                            // Add ICE candidate from server
                            const candidate = message.payload.candidate;

                            if (candidate && pcRef.current) {
                                try {
                                    await pcRef.current.addIceCandidate({
                                        candidate: candidate.candidate,
                                        sdpMid: candidate.sdpMid,
                                        sdpMLineIndex: candidate.sdpMLineIndex
                                    });
                                    logger.debug(`Added remote ICE candidate: ${candidate.candidate}`);
                                } catch (e) {
                                    logger.error('Failed to add ICE candidate:', e);
                                }
                            } else if (!candidate) {
                                logger.debug('Received end-of-candidates signal from server');
                            }
                            break;

                        case 'error':
                            // Check if this is a quota/service key error
                            if (message.payload?.error_type === 'quota_exceeded' ||
                                message.payload?.error_type === 'invalid_service_key' ||
                                message.payload?.error_type === 'quota_check_failed') {
                                // Log as info since it's a handled business logic case
                                logger.info('Quota/service key error, showing user dialog:', message.payload.message);

                                // Set error state for display
                                setApiKeyErrorCode(message.payload.error_type);
                                setApiKeyError(message.payload.message || 'Service quota exceeded');
                                setApiKeyModalOpen(true);

                                // Stop the connection gracefully
                                setConnectionStatus('failed');
                                setConnectionActive(false);

                                // Close WebSocket and peer connection
                                if (wsRef.current) {
                                    wsRef.current.close();
                                    wsRef.current = null;
                                }
                                if (pcRef.current) {
                                    pcRef.current.close();
                                    pcRef.current = null;
                                }
                            } else {
                                // Log other errors as actual errors
                                logger.error('Server error:', message.payload);
                            }
                            break;

                        case 'rtf-user-transcription': {
                            const transcription = message.payload;

                            // Show one-time warning if user speaks while muted on a no-interrupt node
                            // Skip during initial bot greeting (muted by MuteUntilFirstBotComplete strategy)
                            if (
                                !interruptWarningShownRef.current &&
                                firstBotSpeechCompletedRef.current &&
                                userMutedRef.current &&
                                currentAllowInterruptRef.current === false
                            ) {
                                const warningId = nextFeedbackMessageId('interrupt-warning');
                                interruptWarningShownRef.current = true;
                                setFeedbackMessages(prev => [...prev, {
                                    id: warningId,
                                    type: 'interrupt-warning',
                                    text: 'Interruption is disabled for this step. The bot will finish speaking before processing your input. You can enable interruption in the workflow editor.',
                                    timestamp: new Date().toISOString(),
                                }]);
                            }

                            const transcriptionId = nextFeedbackMessageId('user');
                            setFeedbackMessages(prev => {
                                // Step 1: Finalize the last bot message (user started speaking)
                                const messagesWithBotFinalized = prev.map((msg, idx) => {
                                    const isLastMessage = idx === prev.length - 1;
                                    const isUnfinalizedBotMessage = msg.type === 'bot-text' && !msg.final;
                                    return isLastMessage && isUnfinalizedBotMessage
                                        ? { ...msg, final: true }
                                        : msg;
                                });

                                // Step 2: Remove any previous interim transcription
                                const messagesWithoutInterim = messagesWithBotFinalized.filter(
                                    msg => !(msg.type === 'user-transcription' && !msg.final)
                                );

                                // Step 3: Add new transcription (interim or final)
                                return [...messagesWithoutInterim, {
                                    id: transcriptionId,
                                    type: 'user-transcription',
                                    text: transcription.text,
                                    final: transcription.final,
                                    timestamp: new Date().toISOString(),
                                }];
                            });
                            break;
                        }

                        case 'rtf-bot-text': {
                            // TTS text comes as sentences/phrases, concatenate with space
                            const botMessageId = nextFeedbackMessageId('bot');
                            setFeedbackMessages(prev => {
                                const last = prev[prev.length - 1];
                                if (last && last.type === 'bot-text' && !last.final) {
                                    // Append to existing bot message
                                    return [
                                        ...prev.slice(0, -1),
                                        { ...last, text: last.text + ' ' + message.payload.text }
                                    ];
                                }
                                // Start new bot message
                                return [...prev, {
                                    id: botMessageId,
                                    type: 'bot-text',
                                    text: message.payload.text,
                                    final: false,
                                    timestamp: new Date().toISOString(),
                                }];
                            });
                            break;
                        }

                        case 'rtf-function-call-start': {
                            const { function_name, tool_call_id, arguments: toolArguments } = message.payload;
                            const functionCallId = tool_call_id
                                ? `func-${tool_call_id}`
                                : nextFeedbackMessageId('func');
                            setFeedbackMessages(prev => {
                                // Check if we already have this function call
                                if (prev.some(msg => msg.id === functionCallId)) {
                                    return prev;
                                }
                                return [...prev, {
                                    id: functionCallId,
                                    type: 'function-call',
                                    text: function_name ?? 'tool',
                                    functionName: function_name ?? 'tool',
                                    toolCallId: tool_call_id,
                                    arguments: toolArguments,
                                    status: 'running',
                                    timestamp: new Date().toISOString(),
                                }];
                            });
                            break;
                        }

                        case 'rtf-function-call-end': {
                            const { tool_call_id, result } = message.payload;
                            setFeedbackMessages(prev => prev.map(msg =>
                                msg.id === `func-${tool_call_id}`
                                    ? { ...msg, status: 'completed' as const, text: result || msg.text, result }
                                    : msg
                            ));
                            break;
                        }

                        case 'rtf-node-transition': {
                            const {
                                node_id,
                                node_name,
                                previous_node_id,
                                previous_node_name,
                                allow_interrupt,
                            } = message.payload;
                            currentAllowInterruptRef.current = allow_interrupt;
                            const transitionTimestamp = new Date().toISOString();
                            const transition: ConversationNodeTransitionItem = {
                                kind: 'node-transition',
                                id: nextFeedbackMessageId('node'),
                                timestamp: transitionTimestamp,
                                nodeId: node_id,
                                nodeName: node_name ?? 'Node',
                                previousNodeId: previous_node_id,
                                previousNodeName: previous_node_name,
                                allowInterrupt: allow_interrupt,
                            };
                            setFeedbackMessages(prev => [...prev, {
                                id: transition.id,
                                type: 'node-transition',
                                text: transition.nodeName,
                                nodeId: transition.nodeId,
                                nodeName: transition.nodeName,
                                previousNodeId: transition.previousNodeId,
                                previousNode: previous_node_name,
                                allowInterrupt: allow_interrupt,
                                timestamp: transitionTimestamp,
                            }]);
                            onNodeTransitionRef.current?.(transition);
                            break;
                        }

                        case 'rtf-ttfb-metric': {
                            const { ttfb_seconds, processor, model } = message.payload;
                            const metricId = nextFeedbackMessageId('ttfb');
                            setFeedbackMessages(prev => [...prev, {
                                id: metricId,
                                type: 'ttfb-metric',
                                text: `${(ttfb_seconds * 1000).toFixed(0)}ms`,
                                ttfbSeconds: ttfb_seconds,
                                processor,
                                model,
                                timestamp: new Date().toISOString(),
                            }]);
                            break;
                        }

                        case 'rtf-pipeline-error': {
                            const { error, fatal, processor: errorProcessor } = message.payload;
                            const errorId = nextFeedbackMessageId('error');
                            setFeedbackMessages(prev => [...prev, {
                                id: errorId,
                                type: 'pipeline-error',
                                text: error,
                                fatal,
                                processor: errorProcessor,
                                timestamp: new Date().toISOString(),
                            }]);
                            break;
                        }

                        // Ephemeral state signals — update refs only, no UI messages
                        case 'rtf-bot-started-speaking':
                            break;

                        case 'rtf-bot-stopped-speaking':
                            if (!firstBotSpeechCompletedRef.current) {
                                firstBotSpeechCompletedRef.current = true;
                            }
                            // Finalize the last bot message so "speaking..." indicator is removed
                            setFeedbackMessages(prev => {
                                const lastIdx = prev.length - 1;
                                const last = prev[lastIdx];
                                if (last && last.type === 'bot-text' && !last.final) {
                                    const updated = [...prev];
                                    updated[lastIdx] = { ...last, final: true };
                                    return updated;
                                }
                                return prev;
                            });
                            break;

                        case 'rtf-user-mute-started':
                            userMutedRef.current = true;
                            break;

                        case 'rtf-user-mute-stopped':
                            userMutedRef.current = false;
                            break;

                        default:
                            logger.warn('Unknown message type:', message.type);
                    }
                } catch (e) {
                    logger.error('Failed to handle WebSocket message:', e);
                }
            };
        });
    }, [getWebSocketUrl, connectionActive, isCompleted, nextFeedbackMessageId]);

    const negotiate = async () => {
        const pc = pcRef.current;
        const ws = wsRef.current;

        if (!pc || !ws || ws.readyState !== WebSocket.OPEN) {
            logger.error('Cannot negotiate: PC or WebSocket not ready');
            return;
        }

        try {
            // Create offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            const localDescription = pc.localDescription;
            if (!localDescription) return;

            let sdp = localDescription.sdp;

            if (audioCodec !== 'default') {
                sdp = sdpFilterCodec('audio', audioCodec, sdp);
            }

            // Send offer immediately via WebSocket (without waiting for ICE gathering)
            const message = {
                type: 'offer',
                payload: {
                    sdp: sdp,
                    type: 'offer',
                    pc_id: pc_id.current,
                    workflow_id: workflowId,
                    workflow_run_id: workflowRunId,
                    call_context_vars: initialContext
                }
            };

            ws.send(JSON.stringify(message));
            logger.info('Sent offer via WebSocket (ICE trickling enabled)');

        } catch (e) {
            logger.error(`Negotiation failed: ${e}`);
            setConnectionStatus('failed');
        }
    };

    const createLiveKitSession = async () => {
        const baseUrl = client.getConfig().baseUrl || 'http://127.0.0.1:8000';
        const response = await fetch(`${baseUrl}/api/v1/livekit/session/${workflowId}/${workflowRunId}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                initial_context: initialContext,
            }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = typeof payload.detail === 'string'
                ? payload.detail
                : `LiveKit session failed with status ${response.status}`;
            throw new Error(detail);
        }
        return payload as {
            livekit_url: string;
            participant_token: string;
            room_name: string;
            participant_identity: string;
            dispatch_id?: string | null;
        };
    };

    const validateBeforeStart = async () => {
        const response = await validateUserConfigurationsApiV1UserConfigurationsUserValidateGet({
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
            query: {
                validity_ttl_seconds: 86400
            },
        });

        if (response.error) {
            setApiKeyModalOpen(true);
            setApiKeyErrorCode('invalid_api_key');
            let msg = 'API Key Error';
            const detail = (response.error as unknown as { detail?: { errors: { model: string; message: string }[] } }).detail;
            if (Array.isArray(detail)) {
                msg = detail
                    .map((e: { model: string; message: string }) => `${e.model}: ${e.message}`)
                    .join('\n');
            }
            setApiKeyError(msg);
            setConnectionStatus('failed');
            return false;
        }

        const workflowResponse = await validateWorkflowApiV1WorkflowWorkflowIdValidatePost({
            path: {
                workflow_id: workflowId,
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (workflowResponse.error) {
            setWorkflowConfigModalOpen(true);
            let msg = 'Workflow validation failed';
            const errorDetail = workflowResponse.error as { detail?: { errors: WorkflowValidationError[] } };
            if (errorDetail?.detail?.errors) {
                msg = errorDetail.detail.errors
                    .map(err => `${err.kind}: ${err.message}`)
                    .join('\n');
            }
            setWorkflowConfigError(msg);
            setConnectionStatus('failed');
            return false;
        }

        return true;
    };

    const startLiveKit = async () => {
        let localAudioTrack: LocalAudioTrack | null = null;
        try {
            const unsupportedMessage = getAudioCaptureUnsupportedMessage();
            if (unsupportedMessage) {
                setPermissionError(unsupportedMessage);
                setConnectionStatus('failed');
                setConnectionActive(false);
                return;
            }

            const ready = await validateBeforeStart();
            if (!ready) return;

            const audioOptions = selectedAudioInput
                ? { deviceId: { exact: selectedAudioInput } }
                : undefined;
            localAudioTrack = await createLocalAudioTrack(audioOptions);
            liveKitLocalTrackRef.current = localAudioTrack;

            const session = await createLiveKitSession();
            const room = new Room();
            liveKitRoomRef.current = room;
            liveKitIntentionalDisconnectRef.current = false;

            room.on(RoomEvent.Connected, () => {
                setConnectionStatus('connected');
                setConnectionActive(true);
            });
            room.on(RoomEvent.Disconnected, () => {
                setConnectionActive(false);
                if (!liveKitIntentionalDisconnectRef.current && !isCompleted) {
                    setConnectionStatus('failed');
                }
            });
            room.on(RoomEvent.TrackSubscribed, (track) => {
                attachLiveKitAudio(track);
            });
            room.on(RoomEvent.TrackUnsubscribed, (track) => {
                if (track.kind === Track.Kind.Audio) {
                    (track as RemoteAudioTrack).detach();
                }
            });
            room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
                if (topic && topic !== LIVEKIT_FEEDBACK_TOPIC) {
                    return;
                }
                try {
                    const text = new TextDecoder().decode(payload);
                    handleLiveKitFeedbackMessage(JSON.parse(text));
                } catch (error) {
                    logger.error('Failed to handle LiveKit feedback message:', error);
                }
            });

            await room.connect(session.livekit_url, session.participant_token, {
                autoSubscribe: true,
            });
            await room.localParticipant.publishTrack(localAudioTrack, {
                source: Track.Source.Microphone,
            });
            await room.startAudio();
            room.remoteParticipants.forEach((participant) => {
                participant.trackPublications.forEach((publication) => {
                    if (publication.track) {
                        attachLiveKitAudio(publication.track);
                    }
                });
            });
            setConnectionActive(true);
            setConnectionStatus('connected');
        } catch (error) {
            logger.error('Failed to start LiveKit connection:', error);
            if (localAudioTrack) {
                localAudioTrack.stop();
            }
            if (liveKitRoomRef.current) {
                void disconnectLiveKit(false);
            }
            if (error instanceof Error && error.name === 'NotAllowedError') {
                setPermissionError('Microphone access denied. Please allow microphone permissions and try again.');
            } else if (error instanceof Error) {
                setWorkflowConfigModalOpen(true);
                setWorkflowConfigError(error.message);
            }
            setConnectionStatus('failed');
            setConnectionActive(false);
        }
    };

    const start = async () => {
        if (isStarting || !accessToken) return;
        if (appConfigLoading) return;
        await unlockBrowserAudioPlayback();
        setIsStarting(true);
        setConnectionStatus('connecting');
        setPermissionError(null);

        try {
            if (appConfig?.voiceRuntime === 'livekit') {
                await startLiveKit();
                return;
            }

            // Fetch time-limited TURN credentials from backend API only if the
            // server reports a TURN server is configured. Skipping the request
            // avoids a 503 on OSS local deployments that don't run coturn.
            if (appConfig?.turnEnabled === false) {
                logger.info('TURN server disabled in app config, using STUN only');
            } else {
                try {
                    const turnResponse = await getTurnCredentialsApiV1TurnCredentialsGet({
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                        },
                    });
                    if (turnResponse.data) {
                        turnCredentialsRef.current = turnResponse.data;
                        logger.info(`TURN credentials obtained, TTL: ${turnResponse.data.ttl}s`);
                    } else if (turnResponse.response.status === 503) {
                        // TURN not configured on server - this is OK, we'll use STUN only
                        logger.info('TURN server not configured, using STUN only');
                    } else {
                        logger.warn(`Failed to fetch TURN credentials: ${turnResponse.response.status}`);
                    }
                } catch (e) {
                    logger.warn('Failed to fetch TURN credentials, continuing without TURN:', e);
                }
            }

            // Validate API keys
            const response = await validateUserConfigurationsApiV1UserConfigurationsUserValidateGet({
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
                query: {
                    validity_ttl_seconds: 86400
                },
            });

            if (response.error) {
                setApiKeyModalOpen(true);
                setApiKeyErrorCode('invalid_api_key');
                let msg = 'API Key Error';
                const detail = (response.error as unknown as { detail?: { errors: { model: string; message: string }[] } }).detail;
                if (Array.isArray(detail)) {
                    msg = detail
                        .map((e: { model: string; message: string }) => `${e.model}: ${e.message}`)
                        .join('\n');
                }
                setApiKeyError(msg);
                setConnectionStatus('failed');
                return;
            }

            // Validate workflow
            const workflowResponse = await validateWorkflowApiV1WorkflowWorkflowIdValidatePost({
                path: {
                    workflow_id: workflowId,
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (workflowResponse.error) {
                setWorkflowConfigModalOpen(true);
                let msg = 'Workflow validation failed';
                const errorDetail = workflowResponse.error as { detail?: { errors: WorkflowValidationError[] } };
                if (errorDetail?.detail?.errors) {
                    msg = errorDetail.detail.errors
                        .map(err => `${err.kind}: ${err.message}`)
                        .join('\n');
                }
                setWorkflowConfigError(msg);
                setConnectionStatus('failed');
                return;
            }

            // Connect WebSocket first
            await connectWebSocket();

            // Create peer connection
            timeStartRef.current = null;
            const pc = createPeerConnection();

            // Set up media constraints
            const constraints: MediaStreamConstraints = {
                audio: false,
            };

            if (useAudio) {
                const audioConstraints: MediaTrackConstraints = {};
                if (selectedAudioInput) {
                    audioConstraints.deviceId = { exact: selectedAudioInput };
                }
                constraints.audio = Object.keys(audioConstraints).length ? audioConstraints : true;
            }

            // Get user media and negotiate
            if (constraints.audio) {
                try {
                    const unsupportedMessage = getAudioCaptureUnsupportedMessage();
                    if (unsupportedMessage) {
                        setPermissionError(unsupportedMessage);
                        setConnectionStatus('failed');
                        return;
                    }

                    const stream = await navigator.mediaDevices.getUserMedia(constraints);
                    stream.getTracks().forEach((track) => {
                        pc.addTrack(track, stream);
                    });
                    await negotiate();
                } catch (err) {
                    logger.error(`Could not acquire media: ${err}`);
                    setPermissionError(err instanceof Error && err.name === 'NotAllowedError'
                        ? 'Microphone access denied. Please allow microphone permissions and try again.'
                        : 'Could not acquire microphone audio. Check your browser permissions and selected input device.');
                    setConnectionStatus('failed');
                }
            } else {
                await negotiate();
            }
        } catch (error) {
            logger.error('Failed to start connection:', error);
            setConnectionStatus('failed');
        } finally {
            setIsStarting(false);
        }
    };

    const stop = () => {
        setConnectionActive(false);
        setIsCompleted(true);
        setConnectionStatus('idle');

        if (liveKitRoomRef.current || liveKitLocalTrackRef.current) {
            void disconnectLiveKit(true);
            return;
        }

        // Close WebSocket
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        // Close peer connection
        const pc = pcRef.current;
        if (!pc) return;

        if (pc.getTransceivers) {
            pc.getTransceivers().forEach((transceiver) => {
                if (transceiver.stop) {
                    transceiver.stop();
                }
            });
        }

        pc.getSenders().forEach((sender) => {
            if (sender.track) {
                sender.track.stop();
            }
        });

        setTimeout(() => {
            if (pcRef.current) {
                pcRef.current.close();
                pcRef.current = null;
            }
        }, 500);
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (pcRef.current) {
                pcRef.current.close();
            }
            if (liveKitRoomRef.current || liveKitLocalTrackRef.current) {
                void disconnectLiveKit(false);
            }
        };
    }, [disconnectLiveKit]);

    return {
        audioRef,
        audioInputs,
        selectedAudioInput,
        setSelectedAudioInput,
        connectionActive,
        permissionError,
        isCompleted,
        apiKeyModalOpen,
        setApiKeyModalOpen,
        apiKeyError,
        apiKeyErrorCode,
        workflowConfigError,
        workflowConfigModalOpen,
        setWorkflowConfigModalOpen,
        connectionStatus,
        start,
        stop,
        isStarting,
        initialContext,
        getAudioInputDevices,
        feedbackMessages,
        runtimeReady: !appConfigLoading,
    };
};
