import type { FeatureArea, ModuleConnection } from '../../types/analysis';

export function ModuleMapSvg({
  areas,
  connections,
  selectedAreaId,
  onSelect,
}: {
  areas: FeatureArea[];
  connections: ModuleConnection[];
  selectedAreaId: string;
  onSelect: (id: string) => void;
}) {
  const nodes = areas.slice(0, 18);
  const positions = new Map(
    nodes.map((area, index) => [
      area.id,
      {
        x: 28 + (index % 3) * 302,
        y: 110 + Math.floor(index / 3) * 108,
      },
    ]),
  );
  const visibleConnections = connections.filter(
    edge => positions.has(edge.source) && positions.has(edge.target),
  );
  const height = Math.max(210, Math.ceil(nodes.length / 3) * 108 + 140);

  return (
    <svg
      className="module-map-svg"
      viewBox={`0 0 940 ${height}`}
      role="img"
      aria-label="Repository module dependency map"
    >
      <defs>
        <marker id="module-map-arrow" markerWidth="8" markerHeight="7" refX="7" refY="3.5" orient="auto">
          <path d="M0,0 L8,3.5 L0,7 z" fill="#9aa4b5" />
        </marker>
      </defs>
      <g className="module-map-root">
        <rect x="349" y="20" width="242" height="64" rx="8" />
        <text className="module-map-title" x="470" y="47" textAnchor="middle">
          Repository snapshot
        </text>
        <text className="module-map-meta" x="470" y="66" textAnchor="middle">
          contains detected source areas
        </text>
      </g>
      {nodes.map(area => {
        const target = positions.get(area.id)!;
        return (
          <path
            key={`contains-${area.id}`}
            className="module-map-containment"
            d={`M 470 84 C 470 100, ${target.x + 121} 90, ${target.x + 121} ${target.y}`}
            markerEnd="url(#module-map-arrow)"
          />
        );
      })}
      {visibleConnections.map(edge => {
        const source = positions.get(edge.source)!;
        const target = positions.get(edge.target)!;
        return (
          <g key={`${edge.source}-${edge.target}`}>
            <path
              className="module-map-edge"
              d={`M ${source.x + 242} ${source.y + 31} C ${source.x + 272} ${source.y + 31}, ${target.x - 26} ${target.y + 31}, ${target.x - 8} ${target.y + 31}`}
              markerEnd="url(#module-map-arrow)"
            />
            {edge.calls > 1 && (
              <text
                className="module-map-edge-label"
                x={(source.x + target.x) / 2 + 120}
                y={(source.y + target.y) / 2 + 25}
              >
                {edge.calls}
              </text>
            )}
          </g>
        );
      })}
      {nodes.map(area => {
        const position = positions.get(area.id)!;
        return (
          <g
            key={area.id}
            className={`module-map-node ${selectedAreaId === area.id ? 'selected' : ''}`}
            transform={`translate(${position.x},${position.y})`}
            role="button"
            tabIndex={0}
            aria-label={`${area.name} module, ${area.fileCount} files`}
            onClick={() => onSelect(area.id)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(area.id);
              }
            }}
          >
            <rect width="242" height="64" rx="8" />
            <text className="module-map-title" x="13" y="25">
              {area.name.length > 29 ? `${area.name.slice(0, 26)}…` : area.name}
            </text>
            <text className="module-map-meta" x="13" y="46">
              {area.fileCount} files · {area.routeCount} routes · {area.entityCount} entities
            </text>
          </g>
        );
      })}
    </svg>
  );
}
