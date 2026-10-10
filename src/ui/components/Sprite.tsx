// Sprites from the atlases generated out of the ROM (public/sprites).
import { game } from '../../core/gamedata/index.ts';

const base = import.meta.env.BASE_URL;

interface AtlasDef { file: string; cell: number; columns: number }

function AtlasCell({ atlas, index, scale, title, className }: { atlas: AtlasDef; index: number; scale: number; title?: string; className?: string }) {
  const size = atlas.cell * scale;
  const x = (index % atlas.columns) * size;
  const y = Math.floor(index / atlas.columns) * size;
  return (
    <span
      className={`sprite ${className ?? ''}`}
      role="img"
      aria-label={title}
      title={title}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${base}${atlas.file})`,
        backgroundPosition: `-${x}px -${y}px`,
        backgroundSize: `${atlas.columns * size}px auto`,
      }}
    />
  );
}

export function MonIcon({ species, egg, scale = 1, title }: { species: number; egg?: boolean; scale?: number; title?: string }) {
  const index = egg ? game.species.length : game.species[species]?.icon ?? 0;
  return <AtlasCell atlas={game.atlases.icons} index={index} scale={scale} title={title} className="mon-icon" />;
}

export function MonFront({ species, shiny, scale = 2, title }: { species: number; shiny?: boolean; scale?: number; title?: string }) {
  return <AtlasCell atlas={shiny ? game.atlases.frontShiny : game.atlases.front} index={species} scale={scale} title={title} />;
}

export function ItemIcon({ item, scale = 1, title }: { item: number; scale?: number; title?: string }) {
  return <AtlasCell atlas={game.atlases.items} index={item} scale={scale} title={title} />;
}
