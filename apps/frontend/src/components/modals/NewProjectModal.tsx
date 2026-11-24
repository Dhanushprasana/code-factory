import { useState } from 'react';
import { X } from 'lucide-react';
import { apiUrl, request } from '../../api/client';

export function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const createProject = async () => {
    setBusy(true);
    setError('');
    try {
      await request(`${apiUrl}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      onCreated();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create project.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create project"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">New workspace</span>
            <h2>Create project</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label>
          Project name
          <input value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label>
          Description
          <textarea value={description} onChange={event => setDescription(event.target.value)} />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !name.trim()}
            onClick={createProject}
          >
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  );
}
