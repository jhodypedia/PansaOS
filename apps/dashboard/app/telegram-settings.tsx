"use client";
import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, Loader2, RefreshCw, Save, Send, Shield } from "lucide-react";

type BotIdentity = { id: number; username: string; name: string };
type TelegramStatus = {
  configured: boolean;
  enabled: boolean;
  admin_ids: string[];
  bot: BotIdentity | null;
  running: boolean;
  restart_required: boolean;
  source: string;
};
type Api = (path: string, body?: unknown, method?: string) => Promise<unknown>;

export default function TelegramSettingsPanel({ api }: { api: Api }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [token, setToken] = useState("");
  const [admins, setAdmins] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verified, setVerified] = useState<BotIdentity | null>(null);

  useEffect(() => {
    let active = true;
    void api("settings/telegram").then(value => {
      if (!active) return;
      const loaded = value as TelegramStatus;
      setStatus(loaded); setAdmins(loaded.admin_ids.join(", ")); setEnabled(loaded.enabled || !loaded.configured);
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "Unable to load Telegram settings."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  const submit = async (operation: "test" | "save") => {
    if (busy || loading) return;
    setBusy(operation); setError(""); setNotice("");
    try {
      const payload = { bot_token: token.trim() || undefined, admin_ids: admins.trim(), enabled };
      if (operation === "test") {
        const response = await api("settings/telegram/test", payload) as { bot: BotIdentity };
        setVerified(response.bot); setNotice(`Bot verified: @${response.bot.username}. No message was sent.`);
      } else {
        const response = await api("settings/telegram", payload, "PUT") as TelegramStatus;
        setStatus(response); setAdmins(response.admin_ids.join(", ")); setToken(""); setShowToken(false); setVerified(null);
        setNotice(response.restart_required ? "Telegram settings saved encrypted. Restart PansaOS to apply them." : "Telegram settings saved.");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Telegram configuration could not be completed."); }
    finally { setBusy(""); }
  };
  const change = () => { setError(""); setNotice(""); setVerified(null); };

  return <section className="telegram-settings" aria-labelledby="telegram-settings-title">
    <div className="telegram-settings-heading"><span className="telegram-settings-icon"><Send size={21} /></span><div><h2 id="telegram-settings-title">Telegram</h2><p>Connect your bot and choose who can use it.</p></div><span className="badge">{loading ? "LOADING" : status?.restart_required ? "RESTART REQUIRED" : status?.running ? "RUNNING" : status?.configured ? "CONFIGURED" : "NOT CONNECTED"}</span></div>
    {loading ? <p className="telegram-loading"><Loader2 size={15} className="spin" /> Loading Telegram settings…</p> : !status ? <p role="alert" className="error">{error || "Unable to load Telegram settings. Refresh this page to try again."}</p> : <form aria-busy={Boolean(busy)} onSubmit={event => { event.preventDefault(); void submit("save"); }}>
      <fieldset disabled={Boolean(busy)}>
        <label className="telegram-enabled"><input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); change(); }} /><span><strong>Enable Telegram</strong><small>Applied when PansaOS restarts. Existing environment settings are preserved.</small></span></label>
        <label className="provider-field">Bot token<div className="provider-key"><input type={showToken ? "text" : "password"} autoComplete="off" spellCheck={false} value={token} maxLength={256} onChange={event => { setToken(event.target.value); change(); }} placeholder={status.configured ? "Leave blank to keep the saved token" : "Paste the token from BotFather"} /><button className="btn" type="button" aria-label={showToken ? "Hide bot token" : "Show bot token"} onClick={() => setShowToken(value => !value)}>{showToken ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><small>Create a bot with @BotFather on Telegram. Saved tokens are encrypted and never returned to this page.</small></label>
        <label className="provider-field">Admin user IDs<textarea value={admins} onChange={event => { setAdmins(event.target.value); change(); }} placeholder="123456789, 987654321" maxLength={4000} rows={2} aria-describedby="telegram-admin-help" /><small id="telegram-admin-help">Enter numeric Telegram user IDs, separated by commas or new lines. Usernames, bot IDs, and group IDs cannot be used as admin IDs. Only these users can interact with the bot.</small></label>
      </fieldset>
      {(verified || status.bot) && <p className="telegram-bot-identity"><Send size={14} /><span>{(verified ?? status.bot)!.name} <strong>@{(verified ?? status.bot)!.username}</strong></span></p>}
      {error && <p role="alert" className="provider-feedback error">{error}</p>}
      {notice && <p role="status" className="provider-feedback success"><Check size={15} /><span>{notice}</span></p>}
      {status.restart_required && <div className="telegram-restart-note"><strong>Restart required</strong><p>The running bot still uses the previous settings. Finish active tasks, then restart your PansaOS process. For a systemd installation:</p><code>sudo systemctl restart pansa.service</code></div>}
      <div className="telegram-settings-footer"><p><Shield size={14} /> Test bot checks the token with Telegram without sending messages. Saving an enabled bot verifies the token before storing it.</p><div><button className="btn" type="button" disabled={Boolean(busy) || (!token.trim() && !status.configured)} onClick={() => void submit("test")}>{busy === "test" ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} {busy === "test" ? "Testing…" : "Test bot"}</button><button className="btn primary" type="submit" disabled={Boolean(busy)}>{busy === "save" ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {busy === "save" ? "Saving…" : "Save Telegram settings"}</button></div></div>
    </form>}
  </section>;
}
