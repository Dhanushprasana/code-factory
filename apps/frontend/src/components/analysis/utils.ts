import type { FileTreeNode } from '../../types/analysis';

export function buildFileTree(entries: any[]): FileTreeNode[] {
  type MutableNode = {
    name: string;
    path: string;
    type: 'directory' | 'file';
    children: Map<string, MutableNode>;
  };

  const root = new Map<string, MutableNode>();

  for (const entry of entries) {
    const parts = String(entry.path ?? '').split('/').filter(Boolean);
    let siblings = root;
    let parentPath = '';

    parts.forEach((name: string, index: number) => {
      const path = parentPath ? `${parentPath}/${name}` : name;
      const isFile = index === parts.length - 1 && entry.type === 'file';
      let node = siblings.get(name);
      if (!node) {
        node = { name, path, type: isFile ? 'file' : 'directory', children: new Map() };
        siblings.set(name, node);
      }
      if (!isFile) {
        siblings = node.children;
        parentPath = path;
      }
    });
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((left, right) =>
      left.type === right.type
        ? left.name.localeCompare(right.name)
        : left.type === 'directory' ? -1 : 1,
    );
    nodes.forEach(node => sortNodes(node.children));
    return nodes;
  };

  const convert = (nodes: Map<string, MutableNode>): FileTreeNode[] =>
    sortNodes(
      [...nodes.values()].map(node => ({
        name: node.name,
        path: node.path,
        type: node.type,
        children: convert(node.children),
      })),
    );

  return convert(root);
}

export function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  if (!query) return nodes;
  return nodes.flatMap(node => {
    if (node.path.toLowerCase().includes(query)) return [node];
    const children = filterFileTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function countTreeFiles(node: FileTreeNode): number {
  return node.type === 'file' ? 1 : node.children.reduce((sum, child) => sum + countTreeFiles(child), 0);
}

export function findFileTreeNode(nodes: FileTreeNode[], path: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    const child = findFileTreeNode(node.children, path);
    if (child) return child;
  }
  return undefined;
}
