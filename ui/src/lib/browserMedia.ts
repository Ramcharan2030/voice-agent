const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const isLocalhost = () => {
    if (typeof window === "undefined") return false;
    return LOCALHOST_NAMES.has(window.location.hostname);
};

export const getAudioCaptureUnsupportedMessage = () => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
        return "Microphone access is only available in a browser.";
    }

    if (!window.isSecureContext && !isLocalhost()) {
        return "Microphone access requires HTTPS. Open the app on an HTTPS custom domain in Coolify, or use localhost for local testing.";
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        return "This browser does not expose microphone access. Try Chrome/Edge and make sure microphone permissions are allowed.";
    }

    return null;
};

export const getAudioDeviceListUnsupportedMessage = () => {
    const captureMessage = getAudioCaptureUnsupportedMessage();
    if (captureMessage) return captureMessage;

    if (!navigator.mediaDevices?.enumerateDevices) {
        return "This browser cannot list audio input devices.";
    }

    return null;
};
