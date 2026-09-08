import { useEffect, useRef, useState, useCallback } from "react"
import { GameEngine, type CreatureState, type LevelId } from "./game/engine"
import HUD from "./components/HUD"

type AppState = "menu" | "loading" | "playing" | "note" | "dead" | "levelComplete" | "win"

interface NoteData { title: string; text: string }

const LEVEL_INTROS: Record<LevelId, { title: string; body: string }> = {
  1: {
    title: "EL BOSQUE OLVIDADO",
    body: "Despiertas en un claro. El frío te ahoga los pulmones.\nNo recuerdas cómo llegaste aquí.\n\nHay tres llaves rituales dispersas entre los árboles.\nSin ellas, la puerta no se abrirá.\n\nNo estás solo.",
  },
  2: {
    title: "SANATORIO ARKHAM",
    body: "El bosque terminó aquí — en un manicomio abandonado.\nLas paredes huelen a antiséptico y miedo.\n\nNecesitas activar el generador y encontrar una tarjeta de acceso.\n\nAlgo ya vivía en estos pasillos antes de que llegaras.",
  },
  3: {
    title: "LAS CATACUMBAS",
    body: "Bajo el sanatorio hay túneles.\nAntiguos. Tallados a mano.\nAlgo vivió aquí mucho antes que los humanos.\n\nEncuentra los tres fragmentos del código.\nLa puerta al final es tu única salida.\n\nEn la oscuridad total, eres solo instinto.",
  },
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const [appState, setAppState] = useState<AppState>("menu")
  const [level, setLevel] = useState<LevelId>(1)
  const [fear, setFear] = useState(0)
  const [stamina, setStamina] = useState(100)
  const [battery, setBattery] = useState(100)
  const [flashOn, setFlashOn] = useState(true)
  const [creatureState, setCreatureState] = useState<CreatureState>("patrol")
  const [interactHint, setInteractHint] = useState<string | null>(null)
  const [inventory, setInventory] = useState<string[]>([])
  const [hiding, setHiding] = useState(false)
  const [glitch, setGlitch] = useState(false)
  const [activeNote, setActiveNote] = useState<NoteData | null>(null)
  const [pendingLevel, setPendingLevel] = useState<LevelId | null>(null)
  const [exitActive, setExitActive] = useState(false)
  const glitchTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Glitch effect triggered by fear
  useEffect(() => {
    if (fear > 65) {
      const prob = (fear - 65) / 35
      if (Math.random() < prob * 0.05) {
        setGlitch(true)
        clearTimeout(glitchTimerRef.current)
        glitchTimerRef.current = setTimeout(() => setGlitch(false), 60 + Math.random() * 140)
      }
    }
  }, [fear])

  const buildEngine = useCallback((levelId: LevelId) => {
    if (!containerRef.current) return
    // Destroy old engine
    if (engineRef.current) {
      engineRef.current.destroy()
      engineRef.current = null
    }

    const eng = new GameEngine(containerRef.current, {
      onFearChange: (v) => setFear(v),
      onStaminaChange: (v) => setStamina(v),
      onBatteryChange: (v) => { setBattery(v); setFlashOn(v > 0) },
      onItemPickup: () => {
        if (engineRef.current) setInventory(engineRef.current.getInventory())
        if (engineRef.current) setExitActive(engineRef.current.isExitActive())
      },
      onNoteFound: (note) => {
        setActiveNote(note)
        setAppState("note")
        if (engineRef.current) setInventory(engineRef.current.getInventory())
        if (engineRef.current) setExitActive(engineRef.current.isExitActive())
      },
      onInteractHint: (h) => setInteractHint(h),
      onCreatureState: (s) => setCreatureState(s),
      onHideToggle: (h) => setHiding(h),
      onDead: () => setAppState("dead"),
      onLevelComplete: (lvl) => {
        setPendingLevel((lvl + 1) as LevelId)
        setAppState("levelComplete")
      },
      onWin: () => setAppState("win"),
    })

    eng.loadLevel(levelId)
    eng.startLoop()
    engineRef.current = eng
    setLevel(levelId)
    setFear(0)
    setStamina(100)
    setBattery(100)
    setFlashOn(true)
    setCreatureState("patrol")
    setInventory([])
    setHiding(false)
    setExitActive(false)
    setGlitch(false)
    setInteractHint(null)
  }, [])

  // Start level 1
  const startGame = useCallback(() => {
    setAppState("loading")
    setTimeout(() => {
      buildEngine(1)
      setAppState("playing")
    }, 1200)
  }, [buildEngine])

  // Advance to next level
  const goToNextLevel = useCallback(() => {
    if (!pendingLevel) return
    setAppState("loading")
    setTimeout(() => {
      buildEngine(pendingLevel)
      setAppState("playing")
    }, 1200)
  }, [pendingLevel, buildEngine])

  // Restart current level
  const restartLevel = useCallback(() => {
    setAppState("loading")
    setTimeout(() => {
      buildEngine(level)
      setAppState("playing")
    }, 1000)
  }, [level, buildEngine])

  // Dismiss note
  const dismissNote = useCallback(() => {
    setActiveNote(null)
    setAppState("playing")
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.destroy()
    }
  }, [])

  const levelIntro = LEVEL_INTROS[pendingLevel ?? level]
  const currentMeta = engineRef.current?.getLevelMeta()

  return (
    <div className="w-full h-full bg-black overflow-hidden relative select-none">
      {/* Three.js mount */}
      <div ref={containerRef} className="absolute inset-0" />

      {/* ── LOADING ── */}
      {appState === "loading" && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center">
          <div className="scanlines absolute inset-0" />
          <div className="space-y-4 text-center relative z-10" style={{ fontFamily: "'Share Tech Mono', monospace" }}>
            <div className="text-stone-800 text-xs tracking-[0.5em]">CARGANDO</div>
            <div className="flex gap-1 justify-center">
              {[0, 1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="w-1.5 h-5 bg-stone-900"
                  style={{ animation: `flicker ${0.6 + i * 0.15}s infinite ${i * 0.1}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN MENU ── */}
      {appState === "menu" && (
        <div
          className="absolute inset-0 z-40 flex flex-col items-center justify-center"
          style={{ background: "radial-gradient(ellipse at 50% 60%, #080005 0%, #000 70%)" }}
        >
          <div className="scanlines absolute inset-0" />
          <div className="noise-overlay absolute inset-0" />
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.95) 100%)" }}
          />

          <div
            className="relative z-10 flex flex-col items-center gap-6 max-w-md text-center px-6"
            style={{ animation: "fade-in 1.5s ease" }}
          >
            <div className="space-y-1">
              <p
                className="text-red-900 text-xs tracking-[0.5em]"
                style={{ fontFamily: "'Share Tech Mono', monospace" }}
              >
                CLASIFICACIÓN: MAYORES DE 16 AÑOS
              </p>
              <h1
                className="font-creepster text-red-600 text-8xl"
                style={{
                  textShadow: "0 0 40px rgba(180,30,30,0.7), 0 0 100px rgba(180,30,30,0.2)",
                  animation: "flicker 5s infinite",
                }}
              >
                VALGRIM
              </h1>
              <p className="font-creepster text-red-900 text-2xl tracking-[0.2em]">
                NO ERES EL CAZADOR
              </p>
            </div>

            <div className="w-20 h-px bg-red-950 opacity-50" />

            <p
              className="text-stone-500 text-sm leading-relaxed"
              style={{ fontFamily: "'Share Tech Mono', monospace" }}
            >
              Terror psicológico en primera persona.<br />
              Tres niveles. Un enemigo. Ninguna piedad.<br />
              <span className="text-stone-700">Explora, investiga, escóndete, escapa.</span>
            </p>

            {/* Level 3 mini-map mockup */}
            <div
              className="border border-stone-900 p-4 text-left space-y-2"
              style={{ fontFamily: "'Share Tech Mono', monospace" }}
            >
              <p className="text-stone-700 text-xs tracking-widest">— NIVELES —</p>
              <div className="space-y-1">
                {[
                  { n: "01", name: "El Bosque Olvidado", desc: "Encuentra las llaves. Escapa del bosque." },
                  { n: "02", name: "Sanatorio Arkham", desc: "Activa el generador. Encuentra la salida." },
                  { n: "03", name: "Las Catacumbas", desc: "Descifra el código. Huye de las sombras." },
                ].map(({ n, name, desc }) => (
                  <div key={n} className="flex gap-3">
                    <span className="text-red-900 text-xs">{n}</span>
                    <div>
                      <span className="text-stone-500 text-xs">{name}</span>
                      <span className="text-stone-800 text-xs block">{desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="text-stone-700 text-xs space-y-1"
              style={{ fontFamily: "'Share Tech Mono', monospace" }}
            >
              <div><span className="text-stone-500">WASD</span> — Mover &nbsp; <span className="text-stone-500">RATÓN</span> — Mirar</div>
              <div><span className="text-stone-500">SHIFT</span> — Correr &nbsp; <span className="text-stone-500">F</span> — Linterna</div>
              <div><span className="text-stone-500">E</span> — Recoger / Esconderse / Interactuar</div>
            </div>

            <button className="btn-horror mt-2" onClick={startGame}>
              ▶ COMENZAR
            </button>

            <p className="text-stone-900 text-xs" style={{ fontFamily: "'Share Tech Mono', monospace" }}>
              Usa auriculares para mayor inmersión.
            </p>
          </div>
        </div>
      )}

      {/* ── HUD (playing / note) ── */}
      {(appState === "playing" || appState === "note") && (
        <HUD
          level={level}
          levelName={currentMeta?.subtitle ?? ""}
          fear={fear}
          stamina={stamina}
          battery={flashOn}
          batteryPct={battery}
          creatureState={creatureState}
          interactHint={appState === "note" ? null : interactHint}
          inventory={inventory}
          hiding={hiding}
          notesCollected={inventory.filter(id => id.startsWith("note")).length}
          exitActive={exitActive}
          glitch={glitch}
        />
      )}

      {/* ── NOTE OVERLAY ── */}
      {appState === "note" && activeNote && (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.87)" }}
        >
          <div
            className="note-paper max-w-sm w-full mx-6 p-8 relative"
            style={{ animation: "fade-in 0.35s ease-out" }}
          >
            <div
              className="absolute -top-2.5 left-0 right-0 h-5 bg-amber-50"
              style={{
                clipPath: "polygon(0% 100%,2% 0%,5% 75%,9% 5%,13% 90%,17% 10%,22% 80%,27% 0%,33% 95%,39% 5%,45% 85%,52% 0%,58% 90%,65% 8%,72% 85%,79% 2%,86% 90%,93% 5%,100% 100%)",
              }}
            />
            <p
              className="text-stone-500 text-xs tracking-[0.35em] uppercase mb-3"
              style={{ fontFamily: "'Share Tech Mono', monospace" }}
            >
              {activeNote.title}
            </p>
            <div
              className="font-special text-stone-800 text-sm leading-8 whitespace-pre-line"
              style={{ minHeight: "8rem" }}
            >
              {activeNote.text}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                className="btn-horror"
                style={{ borderColor: "rgba(120,100,60,0.5)", color: "#8a7a50" }}
                onClick={dismissNote}
              >
                [E] CONTINUAR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LEVEL COMPLETE ── */}
      {appState === "levelComplete" && pendingLevel && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center"
          style={{ background: "#000", animation: "fade-in 1s ease" }}
        >
          <div className="scanlines absolute inset-0" />
          <div className="noise-overlay absolute inset-0" />

          <div
            className="relative z-10 text-center max-w-md px-6 space-y-6"
            style={{ fontFamily: "'Share Tech Mono', monospace" }}
          >
            <p className="text-stone-700 text-xs tracking-[0.5em]">NIVEL {level} COMPLETADO</p>
            <h2
              className="font-creepster text-green-700 text-5xl"
              style={{ textShadow: "0 0 20px rgba(34,197,94,0.5)" }}
            >
              ESCAPASTE
            </h2>
            <div className="w-20 h-px bg-stone-900 mx-auto" />
            <div className="border border-stone-900 p-5 text-left">
              <p className="text-red-900 text-xs tracking-widest mb-2">SIGUIENTE — NIVEL {pendingLevel}</p>
              <p
                className="font-creepster text-stone-400 text-2xl mb-2"
              >
                {LEVEL_INTROS[pendingLevel].title}
              </p>
              <p className="text-stone-600 text-xs leading-relaxed whitespace-pre-line">
                {LEVEL_INTROS[pendingLevel].body}
              </p>
            </div>
            <button className="btn-horror btn-horror-green" onClick={goToNextLevel}>
              ▶ CONTINUAR
            </button>
          </div>
        </div>
      )}

      {/* ── DEAD ── */}
      {appState === "dead" && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black"
          style={{ animation: "fade-in 2s ease" }}
        >
          <div className="scanlines absolute inset-0" />
          <div className="noise-overlay absolute inset-0" />
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse at center, rgba(100,5,5,0.15) 0%, transparent 70%)" }}
          />

          <div
            className="relative z-10 text-center space-y-5"
            style={{ fontFamily: "'Share Tech Mono', monospace" }}
          >
            <h2
              className="font-creepster text-red-700 text-8xl"
              style={{ textShadow: "0 0 50px rgba(200,20,20,0.8), 0 0 100px rgba(200,20,20,0.3)" }}
            >
              TE ATRAPÓ
            </h2>
            <p className="text-stone-600 text-sm tracking-widest">
              Nivel {level} — {inventory.length} objeto{inventory.length !== 1 ? "s" : ""} recogido{inventory.length !== 1 ? "s" : ""}
            </p>
            <p className="text-stone-800 text-xs">No fue rápido.</p>
            <div className="flex gap-4 justify-center mt-6">
              <button className="btn-horror" onClick={restartLevel}>
                REINTENTAR
              </button>
              <button
                className="btn-horror"
                style={{ borderColor: "rgba(60,60,60,0.5)", color: "#444" }}
                onClick={() => {
                  engineRef.current?.destroy()
                  engineRef.current = null
                  setAppState("menu")
                }}
              >
                MENÚ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── WIN ── */}
      {appState === "win" && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black"
          style={{ animation: "fade-in 2s ease" }}
        >
          <div className="scanlines absolute inset-0" />
          <div className="noise-overlay absolute inset-0" />

          <div
            className="relative z-10 text-center max-w-lg px-6 space-y-6"
            style={{ fontFamily: "'Share Tech Mono', monospace", animation: "fade-in 2.5s ease" }}
          >
            <p className="text-stone-700 text-xs tracking-[0.5em]">VALGRIM — FIN</p>
            <h2
              className="font-creepster text-green-600 text-7xl"
              style={{ textShadow: "0 0 30px rgba(74,222,128,0.5)" }}
            >
              SOBREVIVISTE
            </h2>
            <div className="w-24 h-px bg-green-950 mx-auto" />
            <p className="text-stone-400 text-sm leading-relaxed font-special">
              Saliste de las catacumbas.<br />
              Tres niveles. Tres escapes.<br />
              El bosque, el sanatorio, los túneles.
            </p>
            <p
              className="text-red-900 text-xs leading-relaxed"
              style={{ animation: "fade-in 5s 3s both" }}
            >
              Pero mientras corres hacia la luz del día...<br />
              algo no se siente bien.<br />
              Tu sombra se mueve diferente.<br />
              <br />
              ¿Eras tú quien escapó?
            </p>
            <div className="flex gap-4 justify-center mt-6">
              <button className="btn-horror btn-horror-green" onClick={startGame}>
                JUGAR DE NUEVO
              </button>
              <button
                className="btn-horror"
                style={{ borderColor: "rgba(60,60,60,0.4)", color: "#444" }}
                onClick={() => {
                  engineRef.current?.destroy()
                  engineRef.current = null
                  setAppState("menu")
                }}
              >
                MENÚ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
