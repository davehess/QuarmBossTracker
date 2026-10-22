// The planner's markup: one static string the engine drops into its root, then wires up by id. It is the page of the
// working single-file planner with these changes: the zone's own words and floors come from the zone data, there are
// Versions and Compare tabs and a host bar (React portals into all three), the artifact-only Download button is gone, there
// is a headcount row (off-night planning), an "add to" target for split branches, and a "viewing a saved version" bar.
import type { ZoneData } from '@/lib/routePlanner/types';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function skeletonHtml(Z: ZoneData, readOnly: boolean): string {
  return `
<div id="app">
  <aside id="side">
    <div id="head">
      <h1>${esc(Z.title)} <span id="status" class="local" title="Where your plan is stored"><i></i><span id="statusText">Loading</span></span></h1>
      <div class="sub">${esc(Z.blurb)} <span id="editedBy"></span></div>
      <div class="hostbar" id="hostBar"></div>
    </div>
    <div id="tabs" role="tablist">
      <button class="on" data-tab="plan" role="tab">Plan</button>
      <button data-tab="legs" role="tab">Legs</button>
      <button data-tab="layers" role="tab">Layers</button>
      <button data-tab="mobs" role="tab">Mobs</button>
      <button data-tab="versions" role="tab">Versions</button>
      <button data-tab="compare" role="tab">Compare</button>
    </div>
    <div id="panes">
      <section class="pane on" id="pane-plan">
        ${readOnly ? '<div class="card muted small" id="roNote">You are looking at the officers\' plan. It updates by itself when they change it; only an officer can edit.</div>' : ''}
        ${Z.stub ? `<div class="card small" id="stubNote"><b>${esc(Z.name)}: the zone data has not been loaded yet.</b> The map, the mobs and the build are empty until it is. Pins you drop by hand still work.</div>` : ''}
        <div class="row">
          <button class="primary" id="btnBuild">Build plan from checklist</button>
          <select id="buildOrder" title="How the build orders the objectives">
            <option value="greedy">Order: nearest-next from zone-in</option>
            <option value="checklist">Order: PoP checklist order</option>
          </select>
        </div>
        <div id="buildConfirm" class="card confirm" style="display:none">
          <div>Replace the current plan (<span id="bcCount"></span> pins)? Every officer sees the change.</div>
          <div class="row" style="margin-top:6px"><button class="danger" id="bcYes">Replace it</button><button id="bcNo">Cancel</button></div>
        </div>
        <div class="small muted" id="buildNote" style="margin:6px 0 2px"></div>
        <div class="row" style="margin:8px 0 2px">
          <label class="row small" style="gap:4px">Optional pins:
            <select id="optMode"><option value="include">route through them (dashed)</option><option value="skip">skip them in the route</option></select>
          </label>
        </div>
        <div class="row hc" id="hcRow" style="margin:8px 0 2px">
          <label class="row small" style="gap:4px" title="How many raiders walk the main route together">Raiders:
            <input type="number" id="hcMain" min="0" max="200" step="1" style="width:64px" placeholder="n"></label>
          <label class="row small" style="gap:4px;flex:1;min-width:150px" title="Free text, e.g. 2 tanks, 2 clerics, 1 enchanter">Roles:
            <input type="text" id="hcRoles" maxlength="200" style="flex:1;min-width:0" placeholder="2 tanks, 2 clerics, 1 enchanter"></label>
        </div>
        <div class="row" style="margin:6px 0">
          <button id="btnCopy">Copy plan as text</button>
          <button id="btnClear" class="danger sm">Clear plan</button>
        </div>
        <details class="help" id="helpcard">
          <summary>How to use</summary>
          <ul>
            <li><b>Build plan from checklist</b> drops a pin for every named mob, every checklist objective and every boss on the fight cards (marked <i>on the plan</i>, laid down first). You can then edit everything.</li>
            <li><b>Add pin</b> (map toolbar) then click the map. Or click any mob marker, then <i>Add to plan</i>.</li>
            <li><b>Drag</b> a pin to move it. Drag a row by its handle (or use the arrows) to reorder.</li>
            <li><b>Optional</b> pins are hollow and dashed; so is an <b>optional leg</b> (Legs tab). The Optional switch decides whether the route runs through them; they are never counted in the totals.</li>
            <li><b>Bend a leg:</b> click the line to add a bend point, drag it to pull the line off a wall. Right-click a bend to remove it, right-click a leg to hide it.</li>
            <li><b>Follow paths:</b> pick that tool, click a leg (or its start pin then end pin). The leg becomes the average of the recorded nights that ran between the two pins.</li>
            <li><b>Split:</b> on the Legs tab, <i>Split this leg</i> sends the raid up two or more branches at once (Team A, Team B) and regroups at the leg's end. Pick the branch in the map toolbar to drop its pins. The split's time is its slowest branch.</li>
            <li><b>Teleports:</b> a leg can go <i>via</i> a teleport (Legs tab); the jump is drawn but not counted.</li>
            <li><b>Tracks:</b> turn nights on in Layers. Click a piece of a track to hide it; Layers has Show all again.</li>
            <li><b>/loc:</b> bottom-left shows the cursor as <code>/loc y, x</code>, exactly as the game prints it.</li>
            <li><b>Versions:</b> the plan saves by itself; Save version keeps a copy you can come back to. <b>Compare</b> lays a recorded night over the plan.</li>
          </ul>
        </details>
        <div id="pinList"></div>
        <div id="pinEmpty" class="card muted" style="display:none">No pins yet. Press <b>Build plan from checklist</b>, or switch to <b>Add pin</b> and click the map.</div>
      </section>
      <section class="pane" id="pane-legs"><div id="legList"></div></section>
      <section class="pane" id="pane-layers">
        <div class="card"><h3>Floor (walls)</h3>
          <div class="row" id="floorBtns">
            <button data-floor="all" class="active">All</button>${Z.floors.map(f => `<button data-floor="${esc(f.key)}">${esc(f.label)}</button>`).join('')}
          </div>
          <div class="small muted" style="margin-top:6px">${esc(Z.floorNote)} Pins, mobs and paths on another floor dim when you pick one.</div>
        </div>
        <div class="card"><h3>Recorded nights</h3><div id="nightList"></div>
          <div class="row" style="margin-top:6px"><button id="btnShowAll" class="sm">Show all hidden pieces again</button><span class="small muted" id="hiddenCount"></span></div>
          <div class="small muted" style="margin-top:6px">Median raid-centre position every 3 s (8+ raiders placed in the zone). No names.</div>
        </div>
        <div class="card"><h3>Map layers</h3><div id="layerList"></div></div>
        <div class="card"><h3>Legend</h3><div id="legend" class="small"></div></div>
      </section>
      <section class="pane" id="pane-mobs">
        <input type="text" id="mobSearch" placeholder="Search mobs and events" style="width:100%;margin-bottom:6px">
        <div id="mobList"></div>
        <div class="small muted" style="margin-top:8px">${esc(Z.sourceNote)}</div>
      </section>
      <section class="pane" id="pane-versions"></section>
      <section class="pane" id="pane-compare"></section>
    </div>
  </aside>
  <main id="mapwrap">
    <svg id="map" xmlns="http://www.w3.org/2000/svg" aria-label="${esc(Z.name)} map">
      <g id="world">
        <g id="gGrid"></g><g id="gWalls"></g><g id="gZones"></g><g id="gAvg"></g><g id="gPathers"></g><g id="gLinks"></g><g id="gTracks"></g><g id="gActual"></g><g id="gLegs"></g>
      </g>
      <g id="markers"><g id="gDots"></g><g id="gMarks"></g><g id="gMobs"></g><g id="gActualStops"></g><g id="gArrows"></g><g id="gPins"></g><g id="gBends"></g></g>
    </svg>
    <div class="toolbar">
      <div class="grp" id="modeGrp">
        <button data-mode="select" class="active" title="Move pins, pan, bend legs">Move</button>
        <button data-mode="addpin" title="Click the map to drop a pin">Add pin</button>
        <button data-mode="follow" title="Click a leg to snap it to recorded paths">Follow paths</button>
      </div>
      <select id="addKind" title="Kind for new pins">
        <option value="note">new pin: note</option><option value="boss">new pin: boss</option><option value="named">new pin: named</option>
        <option value="scripted">new pin: scripted</option><option value="objective">new pin: objective</option><option value="door">new pin: door</option>
      </select>
      <select id="addTo" title="Where new pins go: the main route, or a branch of a split" style="display:none"></select>
    </div>
    <div class="zoombar">
      <div class="grp"><button id="zIn" title="Zoom in" aria-label="Zoom in">+</button><button id="zOut" title="Zoom out" aria-label="Zoom out">&minus;</button></div>
      <div class="grp"><button id="zFit">Fit zone</button><button id="zWar">${esc(Z.focus.label)}</button></div>
    </div>
    <div class="banner" id="banner"></div>
    <div class="previewbar" id="previewBar"><span id="previewText"></span><button class="sm primary" id="previewBack">Back to the current plan</button></div>
    <div id="pop"></div>
    <div id="loc">/loc y, x: -</div>
    <div id="scale"><span id="scaleTxt"></span><i id="scaleBar"></i></div>
    <div id="toast" role="status"></div>
  </main>
</div>
<div class="modal-bg" id="modalBg"><div class="modal">
  <div class="row" style="justify-content:space-between"><b>Plan as text</b><button id="modalClose" class="sm">Close</button></div>
  <p class="small muted">Select all and copy.</p>
  <textarea id="modalText" readonly></textarea>
</div></div>`;
}
