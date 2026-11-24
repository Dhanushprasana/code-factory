import { useState } from 'react';
import { X } from 'lucide-react';
import { apiUrl, request } from '../../api/client';
import type { Agent } from '../../types/agent';

export function AgentModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(agent);
  const [name, setName] = useState(agent?.name ?? '');
  const [provider, setProvider] = useState(agent?.provider ?? 'Anthropic');
  const [adapterType, setAdapterType] = useState(agent?.adapterType ?? 'direct-cli');
  const [modelName, setModelName] = useState(agent?.modelName ?? 'claude-3-7-sonnet');
  const [status, setStatus] = useState(agent?.status ?? 'ready');
  const [description, setDescription] = useState(agent?.description ?? '');
  const [executionMode, setExecutionMode] = useState(agent?.settings?.executionMode ?? 'docker-sandbox');
  const [timeoutMinutes, setTimeoutMinutes] = useState(agent?.settings?.timeoutMinutes ?? 25);
  const [credentialReference, setCredentialReference] = useState(agent?.credentialReference ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Agent name is required.');
      return;
    }

    setBusy(true);
    setError('');

    const payload = {
      name: name.trim(),
      provider: provider.trim(),
      adapterType: adapterType.trim(),
      modelName: modelName.trim(),
      status: status.trim(),
      description: description.trim(),
      credentialReference: credentialReference.trim() || null,
      settings: {
        ...(agent?.settings || {}),
        executionMode,
        timeoutMinutes: Number(timeoutMinutes) || 25,
      },
    };

    try {
      if (isEdit && agent) {
        await request(`${apiUrl}/agents/${agent.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await request(`${apiUrl}/agents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Failed to save agent.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        style={{ width: 'min(540px, calc(100vw - 32px))' }}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? 'Edit agent' : 'Register agent'}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">{isEdit ? 'Update Integration' : 'New Integration'}</span>
            <h2>{isEdit ? 'Edit Coding Agent' : 'Register Coding Agent'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <label>
          Agent Name *
          <input
            value={name}
            onChange={e => {
              setName(e.target.value);
              if (error) setError('');
            }}
            placeholder="e.g. Claude Code, Codex, Custom Runner"
            style={!name.trim() ? { borderColor: '#fda29b' } : undefined}
          />
        </label>
        {!name.trim() && (
          <span style={{ fontSize: 11, color: '#b42318', marginTop: 4, display: 'block' }}>
            Agent name is required.
          </span>
        )}

        <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ margin: 0, marginTop: 12 }}>
            Provider
            <select value={provider} onChange={e => setProvider(e.target.value)}>
              <option value="Anthropic">Anthropic</option>
              <option value="OpenAI">OpenAI</option>
              <option value="Google DeepMind">Google DeepMind</option>
              <option value="Google">Google</option>
              <option value="Self-Hosted">Self-Hosted</option>
              <option value="Custom">Custom</option>
            </select>
          </label>

          <label style={{ margin: 0, marginTop: 12 }}>
            Adapter Type
            <select value={adapterType} onChange={e => setAdapterType(e.target.value)}>
              <option value="direct-cli">direct-cli (Subshell)</option>
              <option value="harbor">harbor (Adapter Bridge)</option>
            </select>
          </label>
        </div>

        <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ margin: 0, marginTop: 12 }}>
            Model Name
            <input
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              placeholder="e.g. claude-3-7-sonnet"
            />
          </label>

          <label style={{ margin: 0, marginTop: 12 }}>
            Status
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="ready">Ready (Active)</option>
              <option value="offline">Offline</option>
            </select>
          </label>
        </div>

        <label>
          Description
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description of the agent's specialization or harness..."
            style={{ height: 60 }}
          />
        </label>

        <div className="field-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ margin: 0, marginTop: 12 }}>
            Execution Sandbox Mode
            <select value={executionMode} onChange={e => setExecutionMode(e.target.value)}>
              <option value="docker-sandbox">Docker Sandbox (Isolated)</option>
              <option value="cli-subshell">CLI Subshell</option>
              <option value="container-worktree">Container Worktree</option>
              <option value="harbor-bridge">Harbor Bridge</option>
            </select>
          </label>

          <label style={{ margin: 0, marginTop: 12 }}>
            Timeout (minutes)
            <input
              type="number"
              value={timeoutMinutes}
              onChange={e => setTimeoutMinutes(Number(e.target.value))}
              min={5}
              max={120}
            />
          </label>
        </div>

        <label>
          Credential / Secret Reference (Optional)
          <input
            value={credentialReference}
            onChange={e => setCredentialReference(e.target.value)}
            placeholder="e.g. ENV_AGENT_API_KEY (never plain secrets)"
          />
        </label>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !name.trim()}
            title={!name.trim() ? 'Agent name is required to save' : undefined}
            onClick={handleSubmit}
          >
            {busy ? 'Saving…' : isEdit ? 'Save Changes' : 'Register Agent'}
          </button>
        </div>
      </div>
    </div>
  );
}
