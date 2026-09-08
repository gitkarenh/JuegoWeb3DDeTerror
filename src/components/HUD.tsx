import type { CreatureState } from "../game/engine"

interface HUDProps {
  level: number
  levelName: string
  fear: number
  stamina: number
  battery: boolean
  batteryPct: number
  creatureState: CreatureState
  interactHint: string | null
  inventory: string[]
  hiding: boolean
  notesCollected: number
  exitActive: boolean
  glitch: boolean
}

const fearMeta = (fear: number) => {
  if (fear < 25) return { label: "TRANQUILO", color: "#4ade80", pulse: false }
  if (fear < 50) return { label: "ALERTA", color: "#facc15", pulse: false }
  if (fear < 75) return { label: "PÁNICO", color: "#f97316", pulse: true }
  return { label: "TERROR", color: "#ef4444", pulse: true }
}

const staminaMeta = (s: number) => {
  if (s > 60) return "#4ade80"
  if (s > 30) return "#facc15"
  return "#ef4444"
}

export default function HUD({
  level, levelName, fear, stamina, battery, batteryPct,
  creatureState, interactHint, inventory, hiding, notesCollected,
  exitActive, glitch,
}: HUDProps) {
  const fm = fearMeta(fear)
  const sc = staminaMeta(stamina)

  return (
    <div
      className={`absolute inset-0 z-30 pointer-events-none ${glitch ? "glitch-active" : ""}`}
      style={{ fontFamily: "'Share Tech Mono', monospace" }}
    >
      {/* Scanlines always on */}
      <div className="scanlines absolute inset-0" />
      <div className="noise-overlay absolute inset-0" />

      {/* Vignette - intensifies with fear */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          background: `radial-gradient(ellipse at center, transparent ${Math.max(20, 55 - fear * 0.3)}%, rgba(0,0,0,${0.7 + fear * 0.003}) 100%)`,
        }}
      />

      {/* Creature near: blood vignette */}
      {creatureState === "hunt" && (
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at center, transparent 25%, rgba(180,15,15,0.35) 100%)",
            animation: "pulse-red 0.7s ease-in-out infinite",
          }}
        />
      )}

      {/* Hiding overlay */}
      {hiding && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ background: "rgba(0,0,0,0.88)" }}
        >
          <p className="text-stone-500 text-xs tracking-[0.4em] uppercase mb-2">ESCONDIDO</p>
          <div className="w-12 h-px bg-stone-800 mb-4" />
          <p className="text-stone-700 text-xs">[E] SALIR DEL ESCONDITE</p>
          <p className="text-stone-800 text-xs mt-2">No hagas ruido. No te muevas.</p>
        </div>
      )}

      {/* ── TOP LEFT: Level + creature state ── */}
      {!hiding && (
        <div className="absolute top-5 left-5 space-y-1">
          <div className="text-stone-700 text-xs tracking-[0.3em]">NIVEL {level}</div>
          <div className="text-stone-500 text-xs" style={{ maxWidth: 180 }}>{levelName}</div>
          <div className="mt-2 flex items-center gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: creatureState === "hunt" ? "#ef4444" :
                  creatureState === "alert" || creatureState === "search" ? "#f97316" : "#1a1a1a",
                boxShadow: creatureState === "hunt" ? "0 0 6px #ef4444" : "none",
                animation: creatureState === "hunt" ? "pulse-red 0.5s infinite" : "none",
              }}
            />
            <span
              className="text-xs tracking-widest"
              style={{
                color: creatureState === "hunt" ? "#ef4444" :
                  creatureState === "alert" || creatureState === "search" ? "#f97316" : "#1a1a1a",
              }}
            >
              {creatureState === "patrol" ? "——" :
                creatureState === "idle" ? "——" :
                creatureState === "alert" ? "ALERTA" :
                creatureState === "search" ? "BUSCANDO" : "¡TE VIO !"}
            </span>
          </div>
        </div>
      )}

      {/* ── TOP RIGHT: Fear + Stamina + Battery ── */}
      {!hiding && (
        <div className="absolute top-5 right-5 space-y-3 text-right">
          {/* Fear */}
          <div>
            <div className="flex items-center justify-end gap-2 mb-1">
              <span style={{ color: fm.color }} className="text-xs tracking-widest">{fm.label}</span>
              <span className="text-stone-700 text-xs">MIEDO</span>
            </div>
            <div
              className="w-28 h-1.5 bg-stone-950 border border-stone-900 overflow-hidden ml-auto"
              style={{ boxShadow: fm.pulse ? `0 0 6px ${fm.color}44` : "none" }}
            >
              <div
                style={{
                  width: `${fear}%`,
                  height: "100%",
                  background: fm.color,
                  boxShadow: fear > 70 ? `0 0 8px ${fm.color}` : "none",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
          </div>

          {/* Stamina */}
          <div>
            <div className="flex items-center justify-end gap-2 mb-1">
              <span className="text-xs" style={{ color: sc }}>
                {stamina > 60 ? "RESISTENCIA" : stamina > 30 ? "AGOTADO" : "SIN ALIENTO"}
              </span>
              <span className="text-stone-700 text-xs">SPRINT</span>
            </div>
            <div className="w-28 h-1 bg-stone-950 border border-stone-900 overflow-hidden ml-auto">
              <div
                style={{
                  width: `${stamina}%`,
                  height: "100%",
                  background: sc,
                  transition: "width 0.2s ease",
                }}
              />
            </div>
          </div>

          {/* Battery */}
          <div className="flex items-center justify-end gap-2">
            <span
              className="text-xs"
              style={{
                color: batteryPct > 50 ? "#4ade80" : batteryPct > 20 ? "#facc15" : "#ef4444",
                animation: batteryPct < 20 ? "flicker 2s infinite" : "none",
              }}
            >
              {battery ? `█ ${batteryPct}%` : `░ ${batteryPct}%`}
            </span>
            <span className="text-stone-700 text-xs">LINTERNA [F]</span>
          </div>
        </div>
      )}

      {/* ── BOTTOM LEFT: inventory ── */}
      {!hiding && (
        <div className="absolute bottom-8 left-5 space-y-1">
          {inventory.length > 0 && (
            <div className="text-stone-700 text-xs tracking-widest mb-1">INVENTARIO</div>
          )}
          {inventory.map(id => (
            <div key={id} className="flex items-center gap-2">
              <span
                className="text-xs"
                style={{
                  color: id.startsWith("key") ? "#ffbb33" :
                    id === "keycard" ? "#4488ff" :
                    id === "generator" ? "#44ff88" : "#aaa",
                }}
              >
                {id.startsWith("key_") ? "⬡ LLAVE RITUAL" :
                  id === "keycard" ? "▣ TARJETA ACCESO" :
                  id === "generator" ? "⚡ GENERADOR ON" :
                  id.startsWith("code_") ? `◈ FRAGMENTO ${id.slice(-1)}` :
                  "◉ " + id}
              </span>
            </div>
          ))}
          {exitActive && (
            <div
              className="text-xs tracking-widest mt-1"
              style={{
                color: "#44ff88",
                textShadow: "0 0 8px rgba(68,255,136,0.6)",
                animation: "flicker 3s infinite",
              }}
            >
              ↑ SALIDA ACTIVADA
            </div>
          )}
        </div>
      )}

      {/* ── BOTTOM CENTER: interact hint ── */}
      {interactHint && !hiding && (
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 text-xs tracking-[0.35em] text-stone-300 px-4 py-2 border border-stone-800 bg-black bg-opacity-60"
          style={{ animation: "fade-in 0.2s ease" }}
        >
          {interactHint}
        </div>
      )}

      {/* ── CROSSHAIR ── */}
      {!hiding && <div className="crosshair" />}

      {/* ── BOTTOM RIGHT: controls reminder (fades) ── */}
      {!hiding && (
        <div className="absolute bottom-5 right-5 text-stone-900 text-xs space-y-0.5 text-right">
          <div>WASD — mover</div>
          <div>SHIFT — correr</div>
          <div>F — linterna</div>
          <div>E — interactuar</div>
        </div>
      )}

      {/* High fear: static burst effect */}
      {fear > 85 && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `repeating-linear-gradient(
              ${Math.random() * 360}deg,
              transparent,
              transparent ${Math.random() * 10 + 5}px,
              rgba(255,0,0,0.015) ${Math.random() * 10 + 5}px,
              rgba(255,0,0,0.015) ${Math.random() * 10 + 8}px
            )`,
          }}
        />
      )}
    </div>
  )
}
