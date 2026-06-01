"use client";

import { CheckCircle2, RadioTower, Save, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  getLivekitSettingsApiV1LivekitSettingsGet,
  updateLivekitSettingsApiV1LivekitSettingsPut,
} from "@/client/sdk.gen";
import type { LiveKitSettingsResponse } from "@/client/types.gen";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";

type LiveKitSettings = Omit<LiveKitSettingsResponse, "voice_runtime"> & {
  voice_runtime: "pipecat" | "livekit";
  livekit_api_secret?: string;
};

const emptySettings: LiveKitSettings = {
  voice_runtime: "pipecat",
  livekit_url: "",
  livekit_client_url: "",
  livekit_api_key: "",
  livekit_api_secret: "",
  livekit_api_secret_configured: false,
  livekit_agent_name: "spx-voice",
  livekit_room_prefix: "spx-voice",
  livekit_token_ttl_seconds: 3600,
  livekit_sip_inbound_host: "",
  livekit_sip_max_call_duration_seconds: 1800,
  livekit_enabled: false,
  source: "env",
  worker_managed_by_api: false,
  worker_running: false,
};

export function LiveKitRuntimePanel({ onSaved }: { onSaved?: () => void | Promise<void> }) {
  const { user, getAccessToken, loading: authLoading } = useAuth();
  const [settings, setSettings] = useState<LiveKitSettings>(emptySettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (authLoading || !user) return;
    setLoading(true);
    try {
      const token = await getAccessToken();
      const response = await getLivekitSettingsApiV1LivekitSettingsGet({
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.error) throw new Error(detailFromError(response.error));
      setSettings({
        ...emptySettings,
        ...response.data,
        voice_runtime:
          response.data?.voice_runtime === "livekit" ? "livekit" : "pipecat",
        livekit_api_secret: "",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load LiveKit");
    } finally {
      setLoading(false);
    }
  }, [authLoading, user, getAccessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const update = (
    key: keyof LiveKitSettings,
    value: string | number | boolean,
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const token = await getAccessToken();
      const body = {
        voice_runtime: settings.voice_runtime,
        livekit_url: settings.livekit_url,
        livekit_client_url: settings.livekit_client_url,
        livekit_api_key: settings.livekit_api_key,
        livekit_api_secret: settings.livekit_api_secret || undefined,
        livekit_agent_name: settings.livekit_agent_name,
        livekit_room_prefix: settings.livekit_room_prefix,
        livekit_token_ttl_seconds: settings.livekit_token_ttl_seconds,
        livekit_sip_inbound_host: settings.livekit_sip_inbound_host,
        livekit_sip_max_call_duration_seconds:
          settings.livekit_sip_max_call_duration_seconds,
      };
      const response = await updateLivekitSettingsApiV1LivekitSettingsPut({
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (response.error) throw new Error(detailFromError(response.error));
      setSettings({
        ...emptySettings,
        ...response.data,
        voice_runtime:
          response.data?.voice_runtime === "livekit" ? "livekit" : "pipecat",
        livekit_api_secret: "",
      });
      toast.success("LiveKit runtime saved");
      if (response.data?.vobiz_sync_message) {
        toast.message(response.data.vobiz_sync_message);
      }
      await onSaved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save LiveKit");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Skeleton className="h-72 w-full" />;
  }

  const livekitOn = settings.voice_runtime === "livekit";
  const ready = livekitOn && settings.livekit_enabled;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <RadioTower className="h-5 w-5" />
            Voice runtime
          </CardTitle>
          <CardDescription>
            LiveKit settings used by browser voice tests, Vobiz SIP trunks, and
            inbound dispatch.
          </CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge variant={ready ? "default" : "outline"} className="gap-1">
            {ready ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {ready ? "LiveKit ready" : livekitOn ? "LiveKit incomplete" : "Pipecat"}
          </Badge>
          {settings.worker_managed_by_api && (
            <Badge variant={settings.worker_running ? "secondary" : "outline"}>
              {settings.worker_running ? "Worker running" : "Worker stopped"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between rounded border p-3">
          <div className="space-y-0.5">
            <Label className="text-sm">Use LiveKit</Label>
            <p className="text-xs text-muted-foreground">
              Off keeps the existing Pipecat runtime.
            </p>
          </div>
          <Switch
            checked={livekitOn}
            onCheckedChange={(checked) =>
              update("voice_runtime", checked ? "livekit" : "pipecat")
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="LiveKit URL"
            value={settings.livekit_url}
            placeholder="wss://livekit.example.com"
            onChange={(value) => update("livekit_url", value)}
          />
          <Field
            label="Client URL"
            value={settings.livekit_client_url}
            placeholder="wss://livekit.example.com"
            onChange={(value) => update("livekit_client_url", value)}
          />
          <Field
            label="API key"
            value={settings.livekit_api_key}
            onChange={(value) => update("livekit_api_key", value)}
          />
          <Field
            label="API secret"
            type="password"
            value={settings.livekit_api_secret ?? ""}
            placeholder={
              settings.livekit_api_secret_configured ? "Saved" : "Required"
            }
            onChange={(value) => update("livekit_api_secret", value)}
          />
          <Field
            label="SIP inbound host"
            value={settings.livekit_sip_inbound_host}
            placeholder="sip.example.com"
            onChange={(value) => update("livekit_sip_inbound_host", value)}
          />
          <Field
            label="Agent name"
            value={settings.livekit_agent_name}
            onChange={(value) => update("livekit_agent_name", value)}
          />
          <Field
            label="Room prefix"
            value={settings.livekit_room_prefix}
            onChange={(value) => update("livekit_room_prefix", value)}
          />
          <Field
            label="Max call seconds"
            type="number"
            value={String(settings.livekit_sip_max_call_duration_seconds)}
            onChange={(value) =>
              update(
                "livekit_sip_max_call_duration_seconds",
                value === "" ? 1800 : Number(value),
              )
            }
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving..." : "Save runtime"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number";
}) {
  const id = `livekit-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={type === "password" ? "current-password" : undefined}
      />
    </div>
  );
}

function detailFromError(err: unknown): string {
  if (typeof err === "string") return err;
  const e = err as { detail?: unknown };
  if (typeof e?.detail === "string") return e.detail;
  if (Array.isArray(e?.detail) && e.detail.length > 0) {
    const first = e.detail[0] as { msg?: string };
    if (first?.msg) return first.msg;
  }
  return "Request failed";
}
