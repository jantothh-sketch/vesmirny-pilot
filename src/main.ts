import Phaser from "phaser";
import "./style.css";

type Screen = "menu" | "levels" | "settings" | "play" | "result";
type Mode =
  | "find-key"
  | "meteors"
  | "tunnel"
  | "turbo"
  | "sequence"
  | "special"
  | "typing";

type LevelConfig = {
  id: number;
  title: string;
  subtitle: string;
  mode: Mode;
};

type SaveData = {
  currentLevel: number;
  points: number;
  stars: number;
  rank: string;
  unlockedShips: string[];
  settings: {
    music: boolean;
    sfx: boolean;
  };
  levelStats: Record<string, { bestAccuracy: number; stars: number; bestScore: number }>;
  pilotName: string;
  shipName: string;
  planetName: string;
};

type MissionStats = {
  score: number;
  correct: number;
  attempts: number;
  mistakes: number;
  stars: number;
};

const WIDTH = 1280;
const HEIGHT = 720;
const SAVE_KEY = "vesmirny-pilot-save-v1";
const LETTERS = ["A", "S", "D", "F", "J", "K", "L"];
const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
const SPECIAL_KEYS = ["Shift", "Enter", "Backspace", "Tab", "Escape"];

const LEVELS: LevelConfig[] = [
  { id: 1, title: "Nájdi kláves", subtitle: "Stláčaj veľké písmená a posuň loď ku hviezdam.", mode: "find-key" },
  { id: 2, title: "Meteorický dážď", subtitle: "Znič meteory skôr, než dopadnú.", mode: "meteors" },
  { id: 3, title: "Let tunelom", subtitle: "Šípkami udrž loď v strede vesmírneho tunela.", mode: "tunnel" },
  { id: 4, title: "Turbo motor", subtitle: "SPACE a ENTER zapínajú extra rýchlosť.", mode: "turbo" },
  { id: 5, title: "Zapamätaj si sekvenciu", subtitle: "Zopakuj stále dlhšie vesmírne kódy.", mode: "sequence" },
  { id: 6, title: "Špeciálna výbava", subtitle: "Spoznaj Shift, Enter, Backspace, Tab a Escape.", mode: "special" },
  { id: 7, title: "Napíš svoje meno", subtitle: "Vytvor pilotný preukaz, loď a planétu.", mode: "typing" }
];

const RANKS = [
  { name: "Kadet", stars: 0 },
  { name: "Pilot", stars: 5 },
  { name: "Prieskumník", stars: 10 },
  { name: "Kapitán", stars: 15 },
  { name: "Admirál galaxie", stars: 20 }
];

function defaultSave(): SaveData {
  return {
    currentLevel: 1,
    points: 0,
    stars: 0,
    rank: "Kadet",
    unlockedShips: ["starter"],
    settings: { music: true, sfx: true },
    levelStats: {},
    pilotName: "",
    shipName: "",
    planetName: ""
  };
}

function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    return { ...defaultSave(), ...JSON.parse(raw) };
  } catch {
    return defaultSave();
  }
}

function saveProgress(data: SaveData) {
  const rank = [...RANKS].reverse().find((item) => data.stars >= item.stars);
  data.rank = rank?.name ?? "Kadet";
  if (data.stars >= 8 && !data.unlockedShips.includes("comet")) data.unlockedShips.push("comet");
  if (data.stars >= 16 && !data.unlockedShips.includes("nova")) data.unlockedShips.push("nova");
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

function normalizeKey(event: KeyboardEvent): string {
  if (event.code === "Space") return "SPACE";
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

function displayKey(key: string): string {
  const labels: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    " ": "SPACE"
  };
  return labels[key] ?? key.toUpperCase();
}

function specialInfo(key: string): string {
  const info: Record<string, string> = {
    Shift: "Shift pomáha písať veľké písmená.",
    Enter: "Enter potvrdí voľbu alebo posunie text.",
    Backspace: "Backspace opraví posledné písmeno.",
    Tab: "Tab preskočí na ďalšie miesto.",
    Escape: "Escape zavrie menu alebo vráti späť."
  };
  return info[key] ?? "";
}

function makeUi(html: string) {
  const ui = document.querySelector<HTMLDivElement>("#ui");
  if (!ui) throw new Error("Missing UI root");
  ui.innerHTML = html;
  return ui;
}

class AudioFeedback {
  private context?: AudioContext;

  constructor(private enabled: () => boolean) {}

  play(kind: "ok" | "bad" | "win" | "turbo") {
    if (!this.enabled()) return;
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.context ??= new AudioCtor();
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const freq = kind === "bad" ? 150 : kind === "turbo" ? 420 : kind === "win" ? 660 : 520;
    osc.type = kind === "bad" ? "square" : "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(kind === "bad" ? 95 : freq * 1.4, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === "bad" ? 0.12 : 0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  }
}

class StarfieldScene extends Phaser.Scene {
  private save = loadSave();
  private feedback = new AudioFeedback(() => this.save.settings.sfx);
  private screen: Screen = "menu";
  private menuIndex = 0;
  private levelIndex = 0;
  private ship!: Phaser.GameObjects.Container;
  private stars: Phaser.GameObjects.Arc[] = [];
  private planets: Phaser.GameObjects.Ellipse[] = [];
  private activeLevel?: LevelConfig;
  private stats: MissionStats = { score: 0, correct: 0, attempts: 0, mistakes: 0, stars: 0 };
  private targetKey = "";
  private progress = 0;
  private lives = 3;
  private meteors: Array<{ key: string; group: Phaser.GameObjects.Container; speed: number }> = [];
  private nextMeteorAt = 0;
  private tunnelOffset = 0;
  private sequence: string[] = [];
  private sequenceInput = 0;
  private typingStage = 0;
  private typedValue = "";
  private hudRefresh?: () => void;

  constructor() {
    super("StarfieldScene");
  }

  create() {
    this.createBackground();
    this.createShip();
    this.input.keyboard?.on("keydown", (event: KeyboardEvent) => this.handleKey(event));
    this.showMenu();
  }

  update(time: number, delta: number) {
    this.updateBackground(delta);
    if (this.screen !== "play") return;
    if (this.activeLevel?.mode === "meteors") this.updateMeteors(time, delta);
    if (this.activeLevel?.mode === "tunnel") this.updateTunnel(delta);
  }

  private createBackground() {
    this.cameras.main.setBackgroundColor("#071126");
    for (let i = 0; i < 130; i += 1) {
      const star = this.add.circle(
        Phaser.Math.Between(0, WIDTH),
        Phaser.Math.Between(0, HEIGHT),
        Phaser.Math.FloatBetween(1, 2.4),
        Phaser.Display.Color.GetColor(180 + Math.random() * 75, 210 + Math.random() * 45, 255)
      );
      star.setData("speed", Phaser.Math.FloatBetween(0.08, 0.42));
      this.stars.push(star);
    }

    const planetData = [
      [1080, 130, 76, 0xff70b8],
      [135, 585, 48, 0x47e8ff],
      [1000, 600, 38, 0xffe66b]
    ] as const;
    for (const [x, y, size, color] of planetData) {
      const planet = this.add.ellipse(x, y, size * 1.25, size, color, 0.38);
      planet.setStrokeStyle(3, 0xffffff, 0.18);
      this.planets.push(planet);
    }
  }

  private createShip() {
    this.ship = this.add.container(210, 360);
    const flame = this.add.triangle(-42, 5, 0, 0, -38, -14, -38, 14, 0xffe66b, 0.85);
    const body = this.add.triangle(0, 0, -36, -24, -36, 24, 44, 0, 0x47e8ff, 1);
    const wingA = this.add.triangle(-16, -15, -48, -44, -10, -26, 8, -12, 0xff70b8, 1);
    const wingB = this.add.triangle(-16, 15, -48, 44, -10, 26, 8, 12, 0xff70b8, 1);
    const glass = this.add.circle(0, 0, 11, 0xffffff, 0.9);
    flame.setData("flame", true);
    this.ship.add([flame, wingA, wingB, body, glass]);
    this.tweens.add({
      targets: this.ship,
      y: 350,
      yoyo: true,
      repeat: -1,
      duration: 1100,
      ease: "Sine.inOut"
    });
  }

  private updateBackground(delta: number) {
    for (const star of this.stars) {
      star.x -= star.getData("speed") * delta;
      if (star.x < -8) {
        star.x = WIDTH + 8;
        star.y = Phaser.Math.Between(0, HEIGHT);
      }
    }
  }

  private showMenu() {
    this.screen = "menu";
    this.menuIndex = 0;
    this.ship.setPosition(250, 380);
    const items = [
      ["Hrať", `Pokračuj na úrovni ${this.save.currentLevel}`],
      ["Výber úrovne", `${this.save.stars} hviezdičiek nazbieraných`],
      ["Nastavenia zvuku", `Efekty: ${this.save.settings.sfx ? "zapnuté" : "vypnuté"}`],
      ["Ukončiť", "Postup je automaticky uložený"]
    ];
    makeUi(`
      <section class="screen">
        <h1 class="title">Vesmírny pilot</h1>
        <p class="subtitle">Farebná cesta galaxiou, ktorá učí orientáciu na klávesnici krok za krokom.</p>
        <div class="menu">
          ${items
            .map(
              ([label, note], index) =>
                `<div class="menu-item ${index === this.menuIndex ? "active" : ""}">${label}<small>${note}</small></div>`
            )
            .join("")}
        </div>
        <p class="subtitle">↑ ↓ vyber, Enter potvrď</p>
      </section>
    `);
  }

  private refreshMenu() {
    if (this.screen === "menu") this.showMenuWithIndex(this.menuIndex);
    if (this.screen === "levels") this.showLevelSelect();
    if (this.screen === "settings") this.showSettings();
  }

  private showMenuWithIndex(index: number) {
    this.menuIndex = index;
    const items = [
      ["Hrať", `Pokračuj na úrovni ${this.save.currentLevel}`],
      ["Výber úrovne", `${this.save.stars} hviezdičiek nazbieraných`],
      ["Nastavenia zvuku", `Efekty: ${this.save.settings.sfx ? "zapnuté" : "vypnuté"}`],
      ["Ukončiť", "Postup je automaticky uložený"]
    ];
    makeUi(`
      <section class="screen">
        <h1 class="title">Vesmírny pilot</h1>
        <p class="subtitle">Hodnosť: ${this.save.rank} | Body: ${this.save.points} | Lode: ${this.save.unlockedShips.length}</p>
        <div class="menu">
          ${items
            .map(
              ([label, note], itemIndex) =>
                `<div class="menu-item ${itemIndex === this.menuIndex ? "active" : ""}">${label}<small>${note}</small></div>`
            )
            .join("")}
        </div>
        <p class="subtitle">↑ ↓ vyber, Enter potvrď</p>
      </section>
    `);
  }

  private showLevelSelect() {
    this.screen = "levels";
    this.levelIndex = Phaser.Math.Clamp(this.levelIndex, 0, LEVELS.length - 1);
    makeUi(`
      <section class="screen level-screen">
        <h1 class="title">Galaktická mapa</h1>
        <div class="menu">
          ${LEVELS.map((level, index) => {
            const stats = this.save.levelStats[`level${level.id}`];
            const unlocked = level.id <= this.save.currentLevel;
            const note = unlocked ? `${stats?.stars ?? 0}/3 hviezdy | ${level.subtitle}` : "Zamknuté, dokonči predchádzajúcu planétu";
            return `<div class="level-button ${index === this.levelIndex ? "active" : ""}">${level.id}. ${level.title}<small>${note}</small></div>`;
          }).join("")}
        </div>
        <p class="subtitle">↑ ↓ vyber, Enter spusti, Escape späť</p>
      </section>
    `);
  }

  private showSettings() {
    this.screen = "settings";
    const items = [
      ["Zvukové efekty", this.save.settings.sfx ? "zapnuté" : "vypnuté"],
      ["Hudba", this.save.settings.music ? "zapnutá" : "vypnutá"],
      ["Späť", "návrat do menu"]
    ];
    makeUi(`
      <section class="screen">
        <h1 class="title">Nastavenia</h1>
        <div class="menu">
          ${items
            .map(
              ([label, note], index) =>
                `<div class="menu-item ${index === this.menuIndex ? "active" : ""}">${label}<small>${note}</small></div>`
            )
            .join("")}
        </div>
        <p class="subtitle">↑ ↓ vyber, Enter zmeň, Escape späť</p>
      </section>
    `);
  }

  private startLevel(level: LevelConfig) {
    this.screen = "play";
    this.activeLevel = level;
    this.stats = { score: 0, correct: 0, attempts: 0, mistakes: 0, stars: 0 };
    this.progress = 0;
    this.lives = 3;
    this.meteors.forEach((meteor) => meteor.group.destroy());
    this.meteors = [];
    this.sequence = [];
    this.sequenceInput = 0;
    this.typingStage = 0;
    this.typedValue = "";
    this.tunnelOffset = 0;
    this.ship.setPosition(210, 360);
    this.createHud(level);

    if (level.mode === "meteors") this.nextMeteorAt = 0;
    if (level.mode === "sequence") this.nextSequenceRound();
    else if (level.mode === "typing") this.nextTypingPrompt();
    else this.nextPrompt();
  }

  private createHud(level: LevelConfig) {
    makeUi(`
      <section class="hud">
        <div class="status-row">
          <div class="chip" id="score">Body 0</div>
          <div class="chip" id="level">${level.id}. ${level.title}</div>
          <div class="chip" id="lives">Životy 3</div>
        </div>
        <div class="prompt-wrap">
          <div class="prompt" id="prompt">?</div>
          <div class="input-line" id="typed" style="display:none"></div>
          <div class="hint" id="hint">${level.subtitle}</div>
          <div class="progress-shell"><div class="progress-bar" id="progress"></div></div>
        </div>
      </section>
    `);
    this.hudRefresh = () => {
      document.querySelector("#score")!.textContent = `Body ${this.stats.score}`;
      document.querySelector("#lives")!.textContent =
        level.mode === "meteors" ? `Životy ${this.lives}` : `Presnosť ${this.accuracy()}%`;
      const bar = document.querySelector<HTMLDivElement>("#progress");
      if (bar) bar.style.width = `${Math.min(100, this.progress)}%`;
    };
    this.hudRefresh();
  }

  private nextPrompt() {
    if (!this.activeLevel) return;
    const prompt = document.querySelector<HTMLDivElement>("#prompt");
    const hint = document.querySelector<HTMLDivElement>("#hint");
    if (!prompt || !hint) return;
    prompt.classList.remove("is-word");

    if (this.activeLevel.mode === "find-key" || this.activeLevel.mode === "meteors") {
      this.targetKey = Phaser.Utils.Array.GetRandom(LETTERS);
      prompt.textContent = this.targetKey;
      hint.textContent = this.activeLevel.mode === "meteors" ? "Stláčaj písmená na padajúcich meteoroch." : "Nájdi tento kláves.";
    }
    if (this.activeLevel.mode === "tunnel") {
      this.targetKey = Phaser.Utils.Array.GetRandom(ARROWS);
      prompt.textContent = displayKey(this.targetKey);
      hint.textContent = "Správna šípka drží loď v strede tunela.";
    }
    if (this.activeLevel.mode === "turbo") {
      this.targetKey = Phaser.Utils.Array.GetRandom(["SPACE", "Enter"]);
      prompt.textContent = displayKey(this.targetKey);
      prompt.classList.add("is-word");
      hint.textContent = "Zapni turbo motor.";
    }
    if (this.activeLevel.mode === "special") {
      this.targetKey = SPECIAL_KEYS[this.stats.correct % SPECIAL_KEYS.length];
      prompt.textContent = displayKey(this.targetKey);
      prompt.classList.add("is-word");
      hint.textContent = specialInfo(this.targetKey);
    }
    this.hudRefresh?.();
  }

  private nextSequenceRound() {
    this.sequence.push(Phaser.Utils.Array.GetRandom(LETTERS));
    this.sequenceInput = 0;
    const prompt = document.querySelector<HTMLDivElement>("#prompt");
    const hint = document.querySelector<HTMLDivElement>("#hint");
    if (!prompt || !hint) return;
    prompt.classList.add("is-word");
    prompt.textContent = this.sequence.join(" ");
    hint.textContent = "Zapamätaj si kód. Začni písať prvé písmeno.";
    this.time.delayedCall(1200, () => {
      if (this.activeLevel?.mode !== "sequence") return;
      prompt.textContent = "?";
      hint.textContent = `Zadaj ${this.sequence.length} klávesov v správnom poradí.`;
    });
  }

  private nextTypingPrompt() {
    const labels = ["Napíš svoje meno", "Názov tvojej lode", "Meno novej planéty", "Slovo: KOMETA"];
    this.typedValue = "";
    const prompt = document.querySelector<HTMLDivElement>("#prompt");
    const typed = document.querySelector<HTMLDivElement>("#typed");
    const hint = document.querySelector<HTMLDivElement>("#hint");
    if (!prompt || !typed || !hint) return;
    prompt.classList.add("is-word");
    prompt.textContent = labels[this.typingStage];
    typed.style.display = "block";
    typed.textContent = "";
    hint.textContent = "Píš písmená, Backspace opraví, Enter potvrdí.";
  }

  private handleKey(event: KeyboardEvent) {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Tab"].includes(event.key)) event.preventDefault();
    const key = normalizeKey(event);
    if (this.screen === "menu") return this.handleMenuKey(key);
    if (this.screen === "levels") return this.handleLevelKey(key);
    if (this.screen === "settings") return this.handleSettingsKey(key);
    if (this.screen === "result") return this.handleResultKey(key);
    if (this.screen === "play") return this.handlePlayKey(key, event);
  }

  private handleMenuKey(key: string) {
    if (key === "ArrowUp") this.menuIndex = Phaser.Math.Wrap(this.menuIndex - 1, 0, 4);
    if (key === "ArrowDown") this.menuIndex = Phaser.Math.Wrap(this.menuIndex + 1, 0, 4);
    if (key === "ArrowUp" || key === "ArrowDown") return this.showMenuWithIndex(this.menuIndex);
    if (key !== "Enter") return;
    if (this.menuIndex === 0) this.startLevel(LEVELS[this.save.currentLevel - 1]);
    if (this.menuIndex === 1) this.showLevelSelect();
    if (this.menuIndex === 2) {
      this.menuIndex = 0;
      this.showSettings();
    }
    if (this.menuIndex === 3) this.showQuit();
  }

  private handleLevelKey(key: string) {
    if (key === "Escape") return this.showMenu();
    if (key === "ArrowUp") this.levelIndex = Phaser.Math.Wrap(this.levelIndex - 1, 0, LEVELS.length);
    if (key === "ArrowDown") this.levelIndex = Phaser.Math.Wrap(this.levelIndex + 1, 0, LEVELS.length);
    if (key === "ArrowUp" || key === "ArrowDown") return this.showLevelSelect();
    if (key === "Enter") {
      const level = LEVELS[this.levelIndex];
      if (level.id <= this.save.currentLevel) this.startLevel(level);
      else this.feedback.play("bad");
    }
  }

  private handleSettingsKey(key: string) {
    if (key === "Escape") return this.showMenu();
    if (key === "ArrowUp") this.menuIndex = Phaser.Math.Wrap(this.menuIndex - 1, 0, 3);
    if (key === "ArrowDown") this.menuIndex = Phaser.Math.Wrap(this.menuIndex + 1, 0, 3);
    if (key === "ArrowUp" || key === "ArrowDown") return this.showSettings();
    if (key !== "Enter") return;
    if (this.menuIndex === 0) this.save.settings.sfx = !this.save.settings.sfx;
    if (this.menuIndex === 1) this.save.settings.music = !this.save.settings.music;
    if (this.menuIndex === 2) return this.showMenu();
    saveProgress(this.save);
    this.showSettings();
  }

  private handleResultKey(key: string) {
    if (key === "Enter") {
      const next = Math.min(this.save.currentLevel, LEVELS.length);
      this.startLevel(LEVELS[next - 1]);
    }
    if (key === "Escape") this.showLevelSelect();
  }

  private handlePlayKey(key: string, event: KeyboardEvent) {
    if (key === "Escape" && this.activeLevel?.mode !== "special" && this.activeLevel?.mode !== "typing") return this.showLevelSelect();
    if (!this.activeLevel) return;
    if (this.activeLevel.mode === "typing") return this.handleTypingKey(key, event);
    if (this.activeLevel.mode === "meteors") return this.hitMeteor(key);
    if (this.activeLevel.mode === "sequence") return this.handleSequenceKey(key);

    this.stats.attempts += 1;
    if (key === this.targetKey || (this.targetKey === "SPACE" && key === "SPACE")) this.correctKey();
    else this.wrongKey();
  }

  private handleTypingKey(key: string, event: KeyboardEvent) {
    const typed = document.querySelector<HTMLDivElement>("#typed");
    if (!typed) return;
    if (key === "Backspace") this.typedValue = this.typedValue.slice(0, -1);
    else if (key === "Enter") {
      this.stats.attempts += Math.max(1, this.typedValue.length);
      this.stats.correct += Math.max(1, this.typedValue.length);
      if (this.typingStage === 0) this.save.pilotName = this.typedValue || "Pilot";
      if (this.typingStage === 1) this.save.shipName = this.typedValue || "Hviezda";
      if (this.typingStage === 2) this.save.planetName = this.typedValue || "Nová Planéta";
      this.typingStage += 1;
      this.progress = (this.typingStage / 4) * 100;
      this.feedback.play("ok");
      if (this.typingStage >= 4) return this.finishLevel();
      return this.nextTypingPrompt();
    } else if (event.key.length === 1 && /^[a-zA-Z ]$/.test(event.key) && this.typedValue.length < 16) {
      this.typedValue += event.key.toUpperCase();
    }
    typed.textContent = this.typedValue;
    this.hudRefresh?.();
  }

  private handleSequenceKey(key: string) {
    const expected = this.sequence[this.sequenceInput];
    this.stats.attempts += 1;
    if (key === expected) {
      this.sequenceInput += 1;
      this.stats.correct += 1;
      this.stats.score += 80;
      this.feedback.play("ok");
      this.sparkle();
      if (this.sequenceInput >= this.sequence.length) {
        this.progress = Math.min(100, this.progress + 20);
        this.boostShip();
        if (this.progress >= 100) return this.finishLevel();
        this.time.delayedCall(450, () => this.nextSequenceRound());
      }
    } else {
      this.stats.mistakes += 1;
      this.feedback.play("bad");
      const hint = document.querySelector<HTMLDivElement>("#hint");
      if (hint) hint.textContent = "Skúsme ten kód ešte raz pomalšie.";
      this.time.delayedCall(500, () => this.nextSequenceRound());
    }
    this.hudRefresh?.();
  }

  private correctKey() {
    this.stats.correct += 1;
    this.stats.score += this.activeLevel?.mode === "turbo" ? 120 : 70;
    this.progress += this.activeLevel?.mode === "special" ? 20 : 10;
    this.feedback.play(this.activeLevel?.mode === "turbo" ? "turbo" : "ok");
    this.boostShip();
    this.sparkle();
    if (this.progress >= 100) return this.finishLevel();
    this.nextPrompt();
  }

  private wrongKey() {
    this.stats.mistakes += 1;
    this.feedback.play("bad");
    const hint = document.querySelector<HTMLDivElement>("#hint");
    if (hint) hint.textContent = "Nevadí, pilot sa učí. Skús ešte raz.";
    this.cameras.main.shake(100, 0.004);
    this.hudRefresh?.();
  }

  private updateMeteors(time: number, delta: number) {
    if (time > this.nextMeteorAt) {
      this.spawnMeteor();
      this.nextMeteorAt = time + Math.max(720, 1450 - this.progress * 5);
    }
    for (const meteor of [...this.meteors]) {
      meteor.group.y += meteor.speed * delta;
      if (meteor.group.y > HEIGHT + 40) {
        meteor.group.destroy();
        this.meteors = this.meteors.filter((item) => item !== meteor);
        this.lives -= 1;
        this.stats.mistakes += 1;
        this.feedback.play("bad");
        this.cameras.main.shake(120, 0.006);
        if (this.lives <= 0) return this.finishLevel();
      }
    }
    this.hudRefresh?.();
  }

  private spawnMeteor() {
    const key = Phaser.Utils.Array.GetRandom(LETTERS);
    const group = this.add.container(Phaser.Math.Between(140, WIDTH - 140), -40);
    const rock = this.add.circle(0, 0, 34, 0x7b658a, 1).setStrokeStyle(4, 0xffe66b, 0.6);
    const text = this.add.text(0, -2, key, {
      fontFamily: "Trebuchet MS, Arial",
      fontSize: "34px",
      fontStyle: "900",
      color: "#ffffff"
    });
    text.setOrigin(0.5);
    group.add([rock, text]);
    this.meteors.push({ key, group, speed: Phaser.Math.FloatBetween(0.12, 0.22) + this.progress / 1200 });
  }

  private hitMeteor(key: string) {
    this.stats.attempts += 1;
    const meteor = this.meteors.find((item) => item.key === key);
    if (!meteor) return this.wrongKey();
    this.stats.correct += 1;
    this.stats.score += 100;
    this.progress += 8;
    this.feedback.play("ok");
    this.sparkle(meteor.group.x, meteor.group.y);
    meteor.group.destroy();
    this.meteors = this.meteors.filter((item) => item !== meteor);
    this.boostShip();
    if (this.progress >= 100) return this.finishLevel();
    this.hudRefresh?.();
  }

  private updateTunnel(delta: number) {
    this.tunnelOffset += delta * 0.002;
    const target = 360 + Math.sin(this.tunnelOffset) * 24;
    this.ship.y = Phaser.Math.Linear(this.ship.y, target, 0.015);
  }

  private boostShip() {
    this.tweens.add({
      targets: this.ship,
      x: this.ship.x + 42,
      duration: 110,
      yoyo: true,
      ease: "Sine.out"
    });
  }

  private sparkle(x = this.ship.x + 46, y = this.ship.y) {
    for (let i = 0; i < 9; i += 1) {
      const dot = this.add.circle(x, y, Phaser.Math.Between(3, 6), Phaser.Utils.Array.GetRandom([0xffe66b, 0x47e8ff, 0x70f09a]));
      this.tweens.add({
        targets: dot,
        x: x + Phaser.Math.Between(-60, 70),
        y: y + Phaser.Math.Between(-46, 46),
        alpha: 0,
        scale: 0.2,
        duration: 420,
        ease: "Sine.out",
        onComplete: () => dot.destroy()
      });
    }
  }

  private finishLevel() {
    if (!this.activeLevel) return;
    const level = this.activeLevel;
    this.screen = "result";
    this.meteors.forEach((meteor) => meteor.group.destroy());
    this.meteors = [];
    const accuracy = this.accuracy();
    const stars = accuracy >= 90 && this.progress >= 100 ? 3 : accuracy >= 70 ? 2 : 1;
    this.stats.stars = stars;
    const key = `level${level.id}`;
    const previous = this.save.levelStats[key];
    const addedStars = Math.max(0, stars - (previous?.stars ?? 0));
    this.save.points += this.stats.score;
    this.save.stars += addedStars;
    this.save.currentLevel = Math.max(this.save.currentLevel, Math.min(LEVELS.length, level.id + 1));
    this.save.levelStats[key] = {
      bestAccuracy: Math.max(previous?.bestAccuracy ?? 0, accuracy),
      stars: Math.max(previous?.stars ?? 0, stars),
      bestScore: Math.max(previous?.bestScore ?? 0, this.stats.score)
    };
    saveProgress(this.save);
    this.feedback.play("win");
    makeUi(`
      <section class="screen">
        <div class="result">
          <h2>Misia splnená</h2>
          <div class="stars">${"★".repeat(stars)}${"☆".repeat(3 - stars)}</div>
          <p>${level.title}</p>
          <p>Body v misii: ${this.stats.score}</p>
          <p>Presnosť: ${accuracy}%</p>
          <p>Hodnosť: ${this.save.rank}</p>
          <p>Enter ďalšia misia | Escape mapa</p>
        </div>
      </section>
    `);
  }

  private accuracy() {
    return Math.round((this.stats.correct / Math.max(1, this.stats.attempts)) * 100);
  }

  private showQuit() {
    this.screen = "result";
    saveProgress(this.save);
    makeUi(`
      <section class="screen">
        <div class="result">
          <h2>Postup uložený</h2>
          <p>Body: ${this.save.points}</p>
          <p>Hviezdy: ${this.save.stars}</p>
          <p>Hodnosť: ${this.save.rank}</p>
          <p>Escape návrat do menu</p>
        </div>
      </section>
    `);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#071126",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: StarfieldScene
});
