import type { FileTreeNode } from '../../types/analysis';
import { countTreeFiles } from './utils';

export function FileTreeRows({
  nodes,
  depth,
  query,
  expandedPaths,
  selectedPath,
  onToggle,
  onSelect,
}: {
  nodes: FileTreeNode[];
  depth: number;
  query: string;
  expandedPaths: Set<string>;
  selectedPath: string;
  onToggle: (path: string) => void;
  onSelect: (node: FileTreeNode) => void;
}) {
  return (
    <>
      {nodes.map(node => {
        const isExpanded = query ? true : expandedPaths.has(node.path);
        return (
          <div key={node.path}>
            <button
              type="button"
              role="treeitem"
              className={`tree-node ${node.type} ${selectedPath === node.path ? 'selected' : ''}`}
              style={{ paddingLeft: `${10 + depth * 15}px` }}
              aria-level={depth + 1}
              aria-selected={selectedPath === node.path}
              aria-expanded={node.type === 'directory' ? isExpanded : undefined}
              onClick={() => {
                onSelect(node);
                if (node.type === 'directory') onToggle(node.path);
              }}
            >
              <span className="tree-caret">{node.type === 'directory' ? (isExpanded ? '▾' : '›') : '·'}</span>
              <span className="tree-name">{node.name}</span>
              {node.type === 'directory' && <span className="tree-count">{countTreeFiles(node)}</span>}
            </button>
            {node.type === 'directory' && isExpanded && node.children.length > 0 && (
              <FileTreeRows
                nodes={node.children}
                depth={depth + 1}
                query={query}
                expandedPaths={expandedPaths}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
