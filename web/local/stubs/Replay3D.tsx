// Local-site stand-in for web/app/spectator/replay/Replay3D.tsx (see next.config.js): the 3D view needs a zone mesh
// the agent does not have, and importing the real one would ship three.js for a view this site never shows. The
// replay board is mounted with `bounded.flat`, which leaves the 2D/3D switch off, so this is never rendered.
export default function Replay3D(_props: Record<string, unknown>) {
  return null;
}
