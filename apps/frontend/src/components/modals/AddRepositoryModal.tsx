import { useState } from 'react';
import { X } from 'lucide-react';
import { apiUrl, request } from '../../api/client';

export function AddRepositoryModal({
  projectId,
  onClose,
  onAdded,
}: {
  projectId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState('');
  const [role, setRole] = useState('backend');
  const [branch, setBranch] = useState('');
  const [commitSha, setCommitSha] = useState('');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [commits, setCommits] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const repositoryAddress = () => {
    const match = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (!match) throw new Error('Enter a GitHub repository URL before loading branches.');
    return { owner: match[1], name: match[2] };
  };

  const searchRepositories = async () => {
    setError('');
    try {
      setMatches(await request<any[]>(`${apiUrl}/github/repositories?query=${encodeURIComponent(search)}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'GitHub search failed.');
    }
  };

  const loadBranches = async () => {
    setError('');
    try {
      const { owner, name } = repositoryAddress();
      setBranches(
        await request<any[]>(
          `${apiUrl}/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches`,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load branches.');
    }
  };

  const loadCommits = async (value: string) => {
    setBranch(value);
    setCommitSha('');
    setError('');
    try {
      const { owner, name } = repositoryAddress();
      setCommits(
        await request<any[]>(
          `${apiUrl}/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits?branch=${encodeURIComponent(value)}`,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load commits.');
    }
  };

  const addRepository = async () => {
    setBusy(true);
    setError('');
    try {
      await request(`${apiUrl}/projects/${projectId}/repositories`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, role, branch: branch || undefined, commitSha: commitSha || undefined }),
      });
      onAdded();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect repository.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal repository-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Add GitHub repository"
        onMouseDown={event => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">Project component</span>
            <h2>Connect repository</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label>
          Find an authorized or public repository
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Repository name"
          />
        </label>
        <button
          className="secondary-button modal-secondary"
          onClick={searchRepositories}
          disabled={!search.trim()}
        >
          Search GitHub
        </button>
        {matches.length > 0 && (
          <select
            aria-label="Search results"
            defaultValue=""
            onChange={event => {
              const item = matches.find(repository => String(repository.externalRepoId) === event.target.value);
              if (item) setUrl(item.cloneUrl);
            }}
          >
            <option value="" disabled>
              Select a result
            </option>
            {matches.map(item => (
              <option key={item.externalRepoId} value={item.externalRepoId}>
                {item.fullName}
                {item.isPrivate ? ' · private' : ''}
              </option>
            ))}
          </select>
        )}
        <label>
          GitHub HTTPS URL
          <input
            value={url}
            onChange={event => setUrl(event.target.value)}
            placeholder="https://github.com/owner/repository"
          />
        </label>
        <div className="field-grid">
          <label>
            Component role
            <select value={role} onChange={event => setRole(event.target.value)}>
              <option value="frontend">Frontend</option>
              <option value="backend">Backend</option>
              <option value="data_engineering">Data engineering</option>
              <option value="ml">ML</option>
              <option value="other">Other</option>
            </select>
          </label>
          <div className="load-control">
            <span>Branch and commit</span>
            <button className="secondary-button" onClick={loadBranches}>
              Load branches
            </button>
          </div>
        </div>
        {branches.length > 0 && (
          <label>
            Branch
            <select value={branch} onChange={event => loadCommits(event.target.value)}>
              <option value="">Select branch</option>
              {branches.map(item => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {commits.length > 0 && (
          <label>
            Commit
            <select value={commitSha} onChange={event => setCommitSha(event.target.value)}>
              <option value="">Select commit</option>
              {commits.map(item => (
                <option key={item.sha} value={item.sha}>
                  {item.sha.slice(0, 10)} · {item.message.split('\n')[0]}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <p className="form-hint">
          Public repositories work without credentials. Private repositories require a ForgeBench GitHub App
          installation with repository contents and metadata read access.
        </p>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !url.trim()}
            onClick={addRepository}
          >
            {busy ? 'Connecting…' : 'Add repository'}
          </button>
        </div>
      </div>
    </div>
  );
}
