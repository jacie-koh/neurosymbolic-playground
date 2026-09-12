/** Small, manipulable scenario labs for the situations without a full model demo. */

import { el, clear } from "../dom";
import { store } from "../state";
import { getSituation } from "../data/situations";

const CELL: Record<string, string> = {
  width: "52px", height: "52px", border: "1px solid var(--line)", borderRadius: "8px",
  background: "var(--panel)", fontWeight: "700", cursor: "pointer",
};
let embeddedLab = false;

function shell(root: HTMLElement, title: string, instruction: string) {
  clear(root);
  if (embeddedLab) {
    const input = el(
      "div",
      { class: "flow-node neural", style: { flex: "1 1 190px", minHeight: "110px" } },
      el("div", { style: { fontSize: "10px", opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.08em" } }, "Input"),
      el("b", { style: { marginTop: "6px" } }, title),
      el("div", { style: { fontSize: "12px", fontWeight: "400", marginTop: "6px" } }, instruction)
    );
    const workspace = el(
      "div",
      { class: "flow-node symbolic", style: { flex: "2 1 340px", minHeight: "160px", display: "block", textAlign: "left" } },
      el("div", { style: { fontSize: "10px", opacity: 0.8, textTransform: "uppercase", letterSpacing: "0.08em" } }, "Rule + interaction")
    );
    const feedback = el(
      "div",
      { class: "flow-node output", style: { flex: "1 1 190px", minHeight: "110px" }, role: "status" },
      "Interact with the rule step to produce an output."
    );
    root.append(
      el("div", { class: "flow-demo", style: { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px", alignItems: "stretch" } },
        input,
        el("div", { class: "flow-arrow" }, "→"),
        workspace,
        el("div", { class: "flow-arrow" }, "→"),
        feedback
      )
    );
    return { feedback, mount: (...nodes: HTMLElement[]) => workspace.append(...nodes) };
  }
  const feedback = el("div", { class: "note", style: { marginTop: "16px" }, role: "status" });
  root.append(
    el("div", { class: "view-head" }, el("h2", {}, title), el("p", {}, instruction)),
    feedback
  );
  return { feedback, mount: (...nodes: HTMLElement[]) => root.append(...nodes) };
}

function actions() {
  if (embeddedLab) return el("div");
  return el("div", { class: "btn-row", style: { marginTop: "20px" } },
    el("button", { class: "btn", onclick: () => store.set({ view: "builder", mode: "customize" }) }, "← Back to builder"),
    el("button", { class: "btn", onclick: () => store.set({ view: "situations" }) }, "New situation")
  );
}

function premises(title: string, ...lines: string[]): HTMLElement {
  return el(
    "div",
    { class: "note", style: { marginTop: "16px" } },
    el("b", {}, `${title}: `),
    lines.join(" ")
  );
}

function hitori(root: HTMLElement): void {
  const { feedback, mount } = shell(root, "Hitori Puzzle Lab", "Shade cells to remove duplicate numbers while keeping the remaining cells connected. The complete rule checker updates after every move.");
  // A deliberately small, solvable Hitori instance. One valid solution shades
  // the top-left 1 and the centre 3; the validator does not hard-code it.
  const values = [[1, 1, 2], [2, 3, 3], [3, 2, 1]];
  const shaded = new Set<string>();
  const grid = el("div", { class: "lab-grid", style: { gridTemplateColumns: "repeat(3, 52px)" } });
  const draw = () => {
    clear(grid);
    values.forEach((row, r) => row.forEach((value, c) => {
      const key = `${r}:${c}`;
      grid.append(el("button", {
        style: { ...CELL, background: shaded.has(key) ? "#263238" : "var(--panel)", color: shaded.has(key) ? "#fff" : "inherit" },
        "aria-label": `row ${r + 1} column ${c + 1}: ${value}`,
        onclick: () => { shaded.has(key) ? shaded.delete(key) : shaded.add(key); draw(); },
      }, String(value)));
    }));
    const duplicateGroups = (groups: number[][]) => groups.reduce((count, group) => {
      const seen = new Set<number>();
      group.forEach((value) => { if (seen.has(value)) count++; else seen.add(value); });
      return count;
    }, 0);
    const rows = values.map((row, r) => row.filter((_, c) => !shaded.has(`${r}:${c}`)));
    const cols = values[0].map((_, c) => values.flatMap((row, r) =>
      shaded.has(`${r}:${c}`) ? [] : [row[c]]
    ));
    const duplicates = duplicateGroups(rows) + duplicateGroups(cols);
    let adjacentShades = 0;
    shaded.forEach((key) => {
      const [r, c] = key.split(":").map(Number);
      if (shaded.has(`${r + 1}:${c}`)) adjacentShades++;
      if (shaded.has(`${r}:${c + 1}`)) adjacentShades++;
    });
    const open = values.flatMap((row, r) => row.map((_, c) => `${r}:${c}`)).filter((key) => !shaded.has(key));
    const seen = new Set<string>();
    const queue = open.length ? [open[0]] : [];
    while (queue.length) {
      const key = queue.shift()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const [r, c] = key.split(":").map(Number);
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([nr, nc]) => {
        const next = `${nr}:${nc}`;
        if (open.includes(next) && !seen.has(next)) queue.push(next);
      });
    }
    const disconnected = open.length > 0 && seen.size !== open.length;
    const issues = [
      duplicates ? `${duplicates} duplicate ${duplicates === 1 ? "group" : "groups"}` : "",
      adjacentShades ? `${adjacentShades} adjacent shaded pair${adjacentShades === 1 ? "" : "s"}` : "",
      disconnected ? "unshaded cells are disconnected" : "",
    ].filter(Boolean);
    feedback.textContent = issues.length ? `Rule check: ${issues.join("; ")}.` : "Solved: rows and columns are unique, shaded cells do not touch, and all unshaded cells connect.";
  };
  draw(); mount(
    premises("Rules", "Rows and columns cannot contain duplicate unshaded numbers. Shaded cells cannot touch orthogonally. Every unshaded cell must form one connected region."),
    grid,
    el("div", { class: "btn-row", style: { marginTop: "14px" } }, el("button", { class: "btn", onclick: () => { shaded.clear(); draw(); } }, "Reset puzzle")),
    actions()
  );
}

function maze(root: HTMLElement, fuzzy = false): void {
  const { feedback, mount } = shell(root, fuzzy ? "Fuzzy Maze Navigation Lab" : "Maze Solver Lab", fuzzy ? "Move one cell at a time. Amber tiles are uncertain: use the route with the highest confidence." : "Click an adjacent open square to move from S to G. Walls are blocked by the planner.");
  const board = ["S....", ".##..", ".?.#.", ".#...", "...#G"];
  let pos = [0, 0]; let score = 1;
  const grid = el("div", { class: "lab-grid", style: { gridTemplateColumns: "repeat(5, 52px)" } });
  const draw = () => {
    clear(grid);
    board.forEach((row, r) => [...row].forEach((cell, c) => {
      const distance = Math.abs(pos[0] - r) + Math.abs(pos[1] - c);
      const here = pos[0] === r && pos[1] === c;
      const open = cell !== "#";
      grid.append(el("button", {
        style: { ...CELL, cursor: open && distance === 1 ? "pointer" : "default", background: cell === "#" ? "#334155" : cell === "?" ? "#fff2cf" : here ? "#dbeafe" : "var(--panel)" },
        disabled: !open || distance !== 1,
        onclick: () => { pos = [r, c]; if (cell === "?") score *= 0.65; draw(); },
      }, here ? "●" : cell === "S" ? "S" : cell === "G" ? "G" : cell === "#" ? "■" : cell === "?" ? "?" : ""));
    }));
    const atGoal = board[pos[0]][pos[1]] === "G";
    feedback.textContent = atGoal ? (fuzzy ? `Goal reached with ${(score * 100).toFixed(0)}% route confidence.` : "Goal reached. The route is collision-free.") : fuzzy ? `Route confidence: ${(score * 100).toFixed(0)}%. Avoid amber uncertainty if you can.` : "Choose an adjacent open square.";
  };
  draw(); mount(
    premises("Map legend", "S is the start, G is the goal, ■ is a wall, and ? is an uncertain traversable cell."),
    grid, actions()
  );
}

function zebra(root: HTMLElement): void {
  const { feedback, mount } = shell(root, "Zebra Puzzle Lab", "This compact pet-assignment deduction makes each premise explicit. Once four owners are fixed, the remaining person must own the zebra.");
  const candidates = ["Englishman", "Spaniard", "Ukrainian", "Norwegian", "Japanese"];
  const clues = [
    { text: "The Englishman owns the dog.", eliminate: "Englishman" },
    { text: "The Spaniard owns the snail.", eliminate: "Spaniard" },
    { text: "The Ukrainian owns the fox.", eliminate: "Ukrainian" },
    { text: "The Norwegian owns the horse.", eliminate: "Norwegian" },
  ];
  let clue = 0; let remaining = [...candidates];
  const display = el("div", { class: "lab-grid", style: { gridTemplateColumns: "repeat(5, minmax(100px, 1fr))", marginTop: "18px" } });
  const apply = el("button", { class: "btn primary" }, "Apply next clue");
  const draw = () => {
    clear(display); remaining.forEach((name) => display.append(el("div", { class: "lab-token" }, name)));
    apply.disabled = clue >= clues.length;
    apply.textContent = clue >= clues.length ? "All clues applied" : `Apply: ${clues[clue].text}`;
    feedback.textContent = clue >= clues.length ? "Only Japanese remains: by elimination, Japanese owns the zebra." : `${remaining.length} possible zebra owners remain. Next clue: ${clues[clue].text}`;
  };
  apply.onclick = () => { remaining = remaining.filter((name) => name !== clues[clue].eliminate); clue++; draw(); };
  draw(); mount(
    premises("Compact case", "Dog, snail, fox, and horse are already assigned by the four displayed premises. The only unassigned pet is the zebra."),
    el("div", { class: "btn-row", style: { marginTop: "16px" } }, apply), display, actions()
  );
}

function bridge(root: HTMLElement): void {
  const { feedback, mount } = shell(root, "Contract Bridge Bidding Lab", "Bid this 17-HCP hand with five spades. The convention engine checks your choice.");
  const hand = el("div", { class: "lab-token-row" }, ...["♠ A K Q J 9", "♥ 8 4", "♦ A 6", "♣ 7 3"].map((card) => el("div", { class: "lab-token" }, card)));
  const bids = ["Pass", "1♣", "1♠", "2♣"].map((bid) => el("button", { class: "btn", onclick: () => {
    feedback.textContent = bid === "1♠" ? "Correct: 1♠ shows an opening-strength hand and your five-card major." : `${bid} is rejected: this hand has opening strength and a five-card spade suit.`;
  } }, bid));
  mount(
    premises("Convention", "Open at the one level with 12–21 HCP. With a five-card major, name the major first."),
    hand, el("div", { class: "btn-row", style: { marginTop: "16px" } }, ...bids), actions()
  );
  feedback.textContent = "Choose an opening bid.";
}

function jigsaw(root: HTMLElement): void {
  const { feedback, mount } = shell(root, "Jigsaw Reconstruction Lab", "Select two tiles to swap them. The matching rule accepts the solved arrangement.");
  let tiles = [3, 1, 2, 6, 4, 5, 9, 7, 8]; let selected: number | null = null;
  const grid = el("div", { class: "lab-grid", style: { gridTemplateColumns: "repeat(3, 72px)" } });
  const draw = () => {
    clear(grid);
    tiles.forEach((tile, index) => grid.append(el("button", { style: { ...CELL, width: "72px", height: "72px", outline: selected === index ? "3px solid var(--pos)" : "none" }, onclick: () => {
      if (selected === null) selected = index;
      else { [tiles[selected], tiles[index]] = [tiles[index], tiles[selected]]; selected = null; }
      draw();
    } }, String(tile))));
    feedback.textContent = tiles.every((tile, index) => tile === index + 1) ? "Solved: every edge matches its neighbor." : selected === null ? "Select two tiles to swap." : "Now select the tile to swap with it.";
  };
  draw(); mount(
    premises("Goal", "Restore tiles in reading order: 1–3 on the top row, 4–6 in the middle, and 7–9 on the bottom."),
    grid, actions()
  );
}

function wordSearch(root: HTMLElement): void {
  const { feedback, mount } = shell(root, "Word Search Lab", "Select the letters C → A → T on the diagonal, then submit the path.");
  const letters = [["C", "R", "D"], ["S", "A", "O"], ["L", "P", "T"]]; const path: string[] = [];
  const grid = el("div", { class: "lab-grid", style: { gridTemplateColumns: "repeat(3, 62px)" } });
  const submit = el("button", { class: "btn primary" }, "Check word");
  const draw = () => { clear(grid); letters.forEach((row, r) => row.forEach((letter, c) => {
    const key = `${r}:${c}`; grid.append(el("button", { style: { ...CELL, width: "62px", height: "62px", background: path.includes(key) ? "#dbeafe" : "var(--panel)" }, onclick: () => { if (!path.includes(key)) path.push(key); draw(); } }, letter));
  })); feedback.textContent = path.length ? `Selected: ${path.map((key) => letters[+key[0]][+key[2]]).join("")}` : "Choose letters in order."; };
  submit.onclick = () => { const word = path.map((key) => letters[+key[0]][+key[2]]).join(""); feedback.textContent = word === "CAT" ? "CAT accepted: valid dictionary path found." : `“${word}” is not the target path. Reset and try again.`; };
  draw(); mount(
    premises("Dictionary", "The only target word is CAT; a valid path must use adjacent cells in the shown order."),
    grid, el("div", { class: "btn-row", style: { marginTop: "16px" } }, submit, el("button", { class: "btn", onclick: () => { path.length = 0; draw(); } }, "Reset")), actions()
  );
}

function guessWho(root: HTMLElement): void {
  const { feedback, mount } = shell(root, "Guess Who? Deduction Lab", "Ask yes/no attribute questions to eliminate faces, then make your guess.");
  const faces = [{ name: "Ari", glasses: true, hair: "dark" }, { name: "Bea", glasses: false, hair: "light" }, { name: "Cam", glasses: true, hair: "light" }, { name: "Dee", glasses: false, hair: "dark" }];
  let remaining = [...faces]; const target = faces[0];
  const display = el("div", { class: "lab-token-row" });
  const draw = () => { clear(display); remaining.forEach((face) => display.append(el("button", { class: "lab-token", onclick: () => feedback.textContent = face === target ? "Correct — Ari is the target." : `${face.name} conflicts with the observed attributes.` }, `${face.name} · ${face.glasses ? "glasses" : "no glasses"} · ${face.hair} hair`))); feedback.textContent = `${remaining.length} candidates remain. Ask a question.`; };
  const question = (label: string, keep: (face: typeof faces[number]) => boolean) => el("button", { class: "btn", onclick: () => { remaining = remaining.filter(keep); draw(); } }, label);
  draw(); mount(
    premises("Observed target", "The target has glasses and dark hair. Ask either fact to filter the candidate set, then select the remaining face."),
    el("div", { class: "btn-row", style: { marginTop: "16px" } }, question("Glasses? Yes", (f) => f.glasses), question("Dark hair? Yes", (f) => f.hair === "dark")), display, actions()
  );
}

function mafia(root: HTMLElement): void {
  const { feedback, mount } = shell(root, "Mafia / Werewolf Vote Lab", "Choose a suspect. The rule engine resolves the vote when a majority is reached.");
  const votes = new Map<string, number>(); const suspects = ["Alex", "Blair", "Casey"];
  const row = el("div", { class: "btn-row", style: { marginTop: "16px" } });
  const draw = () => { clear(row); suspects.forEach((name) => row.append(el("button", { class: "btn", onclick: () => { votes.set(name, (votes.get(name) ?? 0) + 1); draw(); } }, `${name} (${votes.get(name) ?? 0})`))); const out = suspects.find((name) => (votes.get(name) ?? 0) >= 3); feedback.textContent = out ? `${out} is eliminated by majority vote.` : "Cast votes until one suspect has three."; };
  draw(); mount(
    premises("Vote rule", "Each click casts one vote. A suspect is eliminated when they receive a majority of three votes."),
    row, actions()
  );
}

export function renderSituationLab(root: HTMLElement, embedded = false): void {
  embeddedLab = embedded;
  const id = store.get().situationId;
  const title = getSituation(id)?.title ?? "Situation";
  switch (id) {
    case "hitori": return hitori(root);
    case "zebra-puzzle": return zebra(root);
    case "maze": return maze(root);
    case "fuzzy-maze": return maze(root, true);
    case "contract-bridge": return bridge(root);
    case "jigsaw": return jigsaw(root);
    case "word-search": return wordSearch(root);
    case "guess-who": return guessWho(root);
    case "mafia-werewolf": return mafia(root);
    default: {
      const { feedback, mount } = shell(root, `${title} Lab`, "This situation does not have a runnable lab yet.");
      feedback.textContent = "Choose another situation."; mount(actions());
    }
  }
}
