import * as THREE from "three"

// ── Types ────────────────────────────────────────────────────────────────────

export type CreatureState = "idle" | "patrol" | "alert" | "hunt" | "search"
export type LevelId = 1 | 2 | 3

export interface GameCallbacks {
  onFearChange(v: number): void
  onStaminaChange(v: number): void
  onBatteryChange(v: number): void
  onItemPickup(item: { name: string; desc: string }): void
  onNoteFound(note: { title: string; text: string }): void
  onInteractHint(hint: string | null): void
  onCreatureState(s: CreatureState): void
  onHideToggle(hiding: boolean): void
  onDead(): void
  onLevelComplete(level: LevelId): void
  onWin(): void
}

interface WalkRect { cx: number; cz: number; hw: number; hd: number }
interface Obstacle { px: number; pz: number; r: number }

interface HideSpot {
  pos: THREE.Vector3
  camPos: THREE.Vector3
  radius: number
  occupied: boolean
}

interface Collectible {
  id: string
  type: "key" | "keycard" | "battery" | "note" | "clue"
  mesh: THREE.Object3D
  pos: THREE.Vector3
  collected: boolean
  note?: { title: string; text: string }
}

interface ExitConfig {
  pos: THREE.Vector3
  radius: number
  needItems: string[]
  mesh: THREE.Object3D
  light: THREE.PointLight
}

// ── Per-level static data ────────────────────────────────────────────────────

const LEVEL_META: Record<LevelId, {
  name: string
  subtitle: string
  fogDensity: number
  ambientHex: number
  ambientIntensity: number
  skyHex: number
  creatureSpeed: number
  visionRange: number
  hearingRadius: number
}> = {
  1: {
    name: "EL BOSQUE OLVIDADO",
    subtitle: "Nivel 1 — Encuentra las 3 llaves rituales",
    fogDensity: 0.035, ambientHex: 0x1a2840, ambientIntensity: 2.8, skyHex: 0x05080e,
    creatureSpeed: 1.4, visionRange: 13, hearingRadius: 7,
  },
  2: {
    name: "SANATORIO ARKHAM",
    subtitle: "Nivel 2 — Activa el generador y encuentra la tarjeta",
    fogDensity: 0.04, ambientHex: 0x1a0e0e, ambientIntensity: 1.8, skyHex: 0x000000,
    creatureSpeed: 2.0, visionRange: 15, hearingRadius: 8,
  },
  3: {
    name: "LAS CATACUMBAS",
    subtitle: "Nivel 3 — Descifra el código y escapa",
    fogDensity: 0.035, ambientHex: 0x0e0e1a, ambientIntensity: 1.5, skyHex: 0x000000,
    creatureSpeed: 2.6, visionRange: 10, hearingRadius: 10,
  },
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

function addFloor(scene: THREE.Scene, cx: number, cz: number, w: number, d: number, matColor: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ color: matColor, side: THREE.DoubleSide })
  )
  m.rotation.x = -Math.PI / 2
  m.position.set(cx, 0, cz)
  m.receiveShadow = true
  scene.add(m)
  return m
}

function addCeiling(scene: THREE.Scene, cx: number, cz: number, w: number, d: number, h: number, matColor: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshLambertMaterial({ color: matColor, side: THREE.DoubleSide })
  )
  m.rotation.x = Math.PI / 2
  m.position.set(cx, h, cz)
  scene.add(m)
  return m
}

function addWall(scene: THREE.Scene, x: number, y: number, z: number, w: number, h: number, rotY: number, color: number) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
  )
  m.position.set(x, y, z)
  m.rotation.y = rotY
  m.castShadow = true
  m.receiveShadow = true
  scene.add(m)
  return m
}

function buildTree(scene: THREE.Scene, x: number, z: number) {
  const g = new THREE.Group()
  const h = 5 + Math.random() * 7
  const trunkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0x2a1a0e) })
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08 + Math.random() * 0.17, 0.15 + Math.random() * 0.22, h, 6), trunkMat)
  trunk.position.y = h / 2
  trunk.rotation.z = (Math.random() - 0.5) * 0.12
  g.add(trunk)
  const layers = 2 + Math.floor(Math.random() * 4)
  for (let l = 0; l < layers; l++) {
    const ch = 1.4 + Math.random() * 2.2
    const cr = 0.7 + Math.random() * 1.6
    const fc = new THREE.Color(0x0e3010).lerp(new THREE.Color(0x1a4820), Math.random())
    const cone = new THREE.Mesh(new THREE.ConeGeometry(cr * (1 - l * 0.1), ch, 7), new THREE.MeshLambertMaterial({ color: fc }))
    cone.position.y = h * 0.55 + l * ch * 0.52
    cone.rotation.y = Math.random() * Math.PI
    g.add(cone)
  }
  g.position.set(x, 0, z)
  g.rotation.y = Math.random() * Math.PI * 2
  scene.add(g)
}

// ── Main Engine Class ────────────────────────────────────────────────────────

export class GameEngine {
  scene!: THREE.Scene
  renderer!: THREE.WebGLRenderer
  camera!: THREE.PerspectiveCamera
  private container: HTMLDivElement
  private cb: GameCallbacks
  private animId = 0
  private clock = new THREE.Clock()

  // Player
  private playerPos = new THREE.Vector3()
  private yaw = 0
  private pitch = 0
  private isLocked = false
  private keys = new Set<string>()
  private stamina = 100
  private isHiding = false
  private activeHideSpot: HideSpot | null = null
  private battery = 100
  private flashlightOn = true
  private flashlight!: THREE.SpotLight
  private headBob = 0
  private inventory = new Set<string>()
  private dead = false
  private won = false
  private levelDone = false

  // Creature
  private creature!: THREE.Group
  private creatureState: CreatureState = "patrol"
  private cPos = new THREE.Vector3()
  private waypoints: THREE.Vector3[] = []
  private waypointIdx = 0
  private alertTimer = 0
  private searchTimer = 0
  private lastKnown = new THREE.Vector3()
  private creatureSpeed = 1.4
  private visionRange = 13
  private hearingRadius = 7

  // Level
  private currentLevel: LevelId = 1
  private walkRects: WalkRect[] = []
  private obstacles: Obstacle[] = []
  private hideSpots: HideSpot[] = []
  private collectibles: Collectible[] = []
  private exitCfg: ExitConfig | null = null
  private exitActive = false
  private fear = 0

  constructor(container: HTMLDivElement, cb: GameCallbacks) {
    this.container = container
    this.cb = cb
    this.initRenderer()
    this.buildCreature()
    this.setupInput()
  }

  private initRenderer() {
    this.scene = new THREE.Scene()
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(72, this.container.clientWidth / this.container.clientHeight, 0.1, 90)
    this.scene.add(this.camera)

    // Flashlight — child of camera
    this.flashlight = new THREE.SpotLight(0xccddff, 12, 40, Math.PI / 5.5, 0.35, 0.9)
    this.flashlight.position.set(0, 0, 0)
    const ft = new THREE.Object3D()
    ft.position.set(0, -0.1, -1)
    this.camera.add(this.flashlight)
    this.camera.add(ft)
    this.flashlight.target = ft
  }

  private buildCreature() {
    this.creature = new THREE.Group()
    const dm = new THREE.MeshBasicMaterial({ color: 0x000000 })
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 4, 6), dm)
    body.position.y = 2
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 7, 7), dm)
    head.position.y = 4.2
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.5, 5), dm)
    neck.position.y = 3.8
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 2.8, 4), dm)
    arm1.position.set(0.45, 2.5, 0); arm1.rotation.z = 0.35
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 2.8, 4), dm)
    arm2.position.set(-0.45, 2.5, 0); arm2.rotation.z = -0.35
    this.creature.add(body, head, neck, arm1, arm2)
    this.scene.add(this.creature)
  }

  private setupInput() {
    this.renderer.domElement.addEventListener("click", () => {
      if (!this.isHiding && !this.dead && !this.won && !this.levelDone) {
        this.renderer.domElement.requestPointerLock()
      }
    })
    document.addEventListener("pointerlockchange", this.onPLChange)
    document.addEventListener("mousemove", this.onMouseMove)
    document.addEventListener("keydown", this.onKeyDown)
    document.addEventListener("keyup", this.onKeyUp)
    window.addEventListener("resize", this.onResize)
  }

  private onPLChange = () => {
    this.isLocked = document.pointerLockElement === this.renderer.domElement
  }
  private onMouseMove = (e: MouseEvent) => {
    if (!this.isLocked || this.isHiding) return
    this.yaw -= e.movementX * 0.0022
    this.pitch = Math.max(-1.1, Math.min(1.1, this.pitch - e.movementY * 0.0022))
  }
  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code)
    if (e.code === "KeyE") this.interact()
    if (e.code === "KeyF") this.toggleFlashlight()
  }
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code)
  private onResize = () => {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight)
  }

  private toggleFlashlight() {
    this.flashlightOn = !this.flashlightOn
    this.flashlight.visible = this.flashlightOn
  }

  private interact() {
    if (this.dead || this.won || this.levelDone) return

    if (this.isHiding) {
      this.exitHide()
      return
    }

    // Hide spots
    for (const hs of this.hideSpots) {
      if (!hs.occupied && this.playerPos.distanceTo(hs.pos) < hs.radius + 0.5) {
        this.enterHide(hs)
        return
      }
    }

    // Collectibles
    for (const c of this.collectibles) {
      if (!c.collected && this.playerPos.distanceTo(c.pos) < 1.8) {
        c.collected = true
        c.mesh.visible = false
        this.inventory.add(c.id)
        if (c.note) {
          this.cb.onNoteFound(c.note)
        } else {
          this.cb.onItemPickup({ name: c.id, desc: c.type })
        }
        this.refreshExit()
        return
      }
    }

    // Exit
    if (this.exitCfg && this.exitActive && this.playerPos.distanceTo(this.exitCfg.pos) < this.exitCfg.radius + 0.5) {
      this.completeLevel()
    }
  }

  private enterHide(hs: HideSpot) {
    this.isHiding = true
    this.activeHideSpot = hs
    hs.occupied = true
    this.camera.position.copy(hs.camPos)
    document.exitPointerLock()
    this.cb.onHideToggle(true)
  }

  private exitHide() {
    if (this.activeHideSpot) this.activeHideSpot.occupied = false
    this.activeHideSpot = null
    this.isHiding = false
    this.camera.position.copy(this.playerPos).setComponent(1, 1.7)
    this.cb.onHideToggle(false)
  }

  private refreshExit() {
    if (!this.exitCfg) return
    const needed = this.exitCfg.needItems
    if (needed.length === 0 || needed.every(id => this.inventory.has(id))) {
      this.exitActive = true
      this.exitCfg.light.intensity = 3
      const m = this.exitCfg.mesh as THREE.Mesh
      if (m.material) (m.material as THREE.MeshBasicMaterial).opacity = 0.6
    }
  }

  private completeLevel() {
    this.levelDone = true
    document.exitPointerLock()
    if (this.currentLevel === 3) {
      this.cb.onWin()
    } else {
      this.cb.onLevelComplete(this.currentLevel)
    }
  }

  // ── Collision ──────────────────────────────────────────────────────────────

  private canWalk(p: THREE.Vector3): boolean {
    if (this.currentLevel === 1) {
      for (const o of this.obstacles) {
        if (Math.hypot(p.x - o.px, p.z - o.pz) < o.r + 0.55) return false
      }
      return true
    }
    // Indoor: must be inside a walkable rect
    for (const r of this.walkRects) {
      if (p.x > r.cx - r.hw && p.x < r.cx + r.hw && p.z > r.cz - r.hd && p.z < r.cz + r.hd) return true
    }
    return false
  }

  // ── Creature AI ────────────────────────────────────────────────────────────

  private creatureCanSee(): boolean {
    const toPlayer = new THREE.Vector3().subVectors(this.playerPos, this.cPos)
    const dist = toPlayer.length()
    if (dist > this.visionRange) return false
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(this.creature.rotation)
    const angle = toPlayer.normalize().angleTo(forward)
    return angle < Math.PI / 3  // 60° total cone
  }

  private noiseLevel(): number {
    const running = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")
    const moving = ["KeyW","KeyA","KeyS","KeyD","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].some(k => this.keys.has(k))
    if (this.isHiding) return 0
    if (moving && running) return 14
    if (moving) return 5
    return 1
  }

  private creatureCanHear(): boolean {
    const noise = this.noiseLevel()
    const dist = Math.hypot(this.playerPos.x - this.cPos.x, this.playerPos.z - this.cPos.z)
    return dist < this.hearingRadius * (noise / 7)
  }

  private moveCreatureTo(target: THREE.Vector3, dt: number, spd = this.creatureSpeed) {
    const dir = new THREE.Vector3(target.x - this.cPos.x, 0, target.z - this.cPos.z)
    if (dir.length() < 0.1) return
    dir.normalize().multiplyScalar(spd * dt)
    this.cPos.add(dir)
    this.creature.position.copy(this.cPos)
    this.creature.lookAt(new THREE.Vector3(target.x, this.cPos.y, target.z))
  }

  private updateCreature(dt: number, t: number) {
    const canSee = this.creatureCanSee()
    const canHear = this.creatureCanHear()
    const detected = canSee || canHear

    if (detected) {
      this.lastKnown.copy(this.playerPos)
    }

    switch (this.creatureState) {
      case "idle":
        this.alertTimer -= dt
        if (detected) { this.creatureState = "hunt"; break }
        if (this.alertTimer <= 0) this.creatureState = "patrol"
        break

      case "patrol": {
        const wp = this.waypoints[this.waypointIdx]
        this.moveCreatureTo(wp, dt, this.creatureSpeed * 0.7)
        if (this.cPos.distanceTo(wp) < 1.5) {
          this.waypointIdx = (this.waypointIdx + 1) % this.waypoints.length
        }
        if (detected) {
          this.creatureState = "hunt"
        } else if (canHear) {
          this.creatureState = "alert"
          this.alertTimer = 3.0
        }
        break
      }

      case "alert":
        this.alertTimer -= dt
        // Slow rotation "listening"
        this.creature.rotation.y += dt * 0.8
        if (detected) { this.creatureState = "hunt"; break }
        if (this.alertTimer <= 0) this.creatureState = "patrol"
        break

      case "hunt":
        this.moveCreatureTo(this.playerPos, dt, this.creatureSpeed)
        if (!detected) {
          this.creatureState = "search"
          this.searchTimer = 6 + Math.random() * 4
        }
        break

      case "search":
        this.moveCreatureTo(this.lastKnown, dt, this.creatureSpeed * 0.85)
        this.searchTimer -= dt
        if (detected) { this.creatureState = "hunt"; break }
        if (this.searchTimer <= 0 || this.cPos.distanceTo(this.lastKnown) < 1.2) {
          this.creatureState = "idle"
          this.alertTimer = 2.0
        }
        break
    }

    this.cb.onCreatureState(this.creatureState)

    // Arm sway
    const arms = [this.creature.children[3], this.creature.children[4]]
    arms.forEach((arm, i) => {
      if (arm) arm.rotation.x = Math.sin(t * 2 + i * Math.PI) * 0.35
    })
  }

  // ── Update loop ────────────────────────────────────────────────────────────

  private update(dt: number, t: number) {
    if (this.dead || this.won || this.levelDone) {
      this.renderer.render(this.scene, this.camera)
      return
    }

    // ── Player movement ──
    if (!this.isHiding) {
      const running = (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) && this.stamina > 0
      const spd = running ? 5.5 : 3.5
      const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
      const rt = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
      const mv = new THREE.Vector3()
      if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) mv.add(fw)
      if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) mv.sub(fw)
      if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) mv.sub(rt)
      if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) mv.add(rt)

      const moving = mv.lengthSq() > 0
      if (moving) {
        mv.normalize().multiplyScalar(spd * dt)
        const np = this.playerPos.clone().add(mv)
        np.y = 0
        if (this.canWalk(np)) this.playerPos.copy(np)
        if (running) {
          this.stamina = Math.max(0, this.stamina - dt * 18)
          this.headBob += dt * 9
        } else {
          this.headBob += dt * 5
        }
      } else {
        this.stamina = Math.min(100, this.stamina + dt * 12)
      }

      // Head bob
      const bobY = moving ? Math.sin(this.headBob) * 0.04 : 0
      const bobX = moving ? Math.sin(this.headBob * 0.5) * 0.02 : 0

      this.camera.rotation.order = "YXZ"
      this.camera.rotation.y = this.yaw
      this.camera.rotation.x = this.pitch
      this.camera.position.set(this.playerPos.x + bobX, 1.7 + bobY, this.playerPos.z)

      this.cb.onStaminaChange(Math.round(this.stamina))
    }

    // ── Flashlight battery ──
    if (this.flashlightOn) {
      this.battery = Math.max(0, this.battery - dt * 0.8)
      this.flashlight.intensity = 10 * (this.battery / 100) + 2
      if (this.battery <= 0) { this.flashlightOn = false; this.flashlight.visible = false }
    } else {
      this.battery = Math.min(100, this.battery + dt * 0.2)
    }
    this.cb.onBatteryChange(Math.round(this.battery))

    // ── Creature ──
    this.updateCreature(dt, t)

    // ── Fear ──
    const distXZ = Math.hypot(this.playerPos.x - this.cPos.x, this.playerPos.z - this.cPos.z)
    if (distXZ < 22) {
      this.fear = Math.min(100, this.fear + (22 / distXZ) * dt * 10)
    } else {
      this.fear = Math.max(0, this.fear - dt * 5)
    }
    this.cb.onFearChange(Math.round(this.fear))

    // ── Death ──
    if (distXZ < 1.5 && !this.isHiding) {
      this.dead = true
      document.exitPointerLock()
      this.cb.onDead()
      return
    }

    // ── Interact hint ──
    let hint: string | null = null
    if (!this.isHiding) {
      for (const hs of this.hideSpots) {
        if (!hs.occupied && this.playerPos.distanceTo(hs.pos) < hs.radius + 0.5) {
          hint = "[E] ESCONDERSE"
          break
        }
      }
      for (const c of this.collectibles) {
        if (!c.collected && this.playerPos.distanceTo(c.pos) < 1.8) {
          const labels: Record<string, string> = {
            key: "[E] RECOGER LLAVE", keycard: "[E] RECOGER TARJETA",
            note: "[E] LEER NOTA", battery: "[E] RECOGER BATERÍA", clue: "[E] EXAMINAR PISTA",
          }
          hint = labels[c.type] ?? "[E] RECOGER"
          break
        }
      }
      if (!hint && this.exitCfg && this.exitActive && this.playerPos.distanceTo(this.exitCfg.pos) < this.exitCfg.radius + 0.5) {
        hint = "[E] SALIR"
      }
    } else {
      hint = "[E] SALIR DEL ESCONDITE"
    }
    this.cb.onInteractHint(hint)

    // ── Billboard notes ──
    for (const c of this.collectibles) {
      if (!c.collected) (c.mesh as THREE.Mesh).lookAt(this.camera.position)
    }

    this.renderer.render(this.scene, this.camera)
  }

  // ── Start / loop ───────────────────────────────────────────────────────────

  startLoop() {
    this.clock.start()
    const loop = () => {
      this.animId = requestAnimationFrame(loop)
      const dt = Math.min(this.clock.getDelta(), 0.05)
      const t = this.clock.elapsedTime
      this.update(dt, t)
    }
    loop()
  }

  stopLoop() {
    cancelAnimationFrame(this.animId)
  }

  destroy() {
    this.stopLoop()
    document.removeEventListener("pointerlockchange", this.onPLChange)
    document.removeEventListener("mousemove", this.onMouseMove)
    document.removeEventListener("keydown", this.onKeyDown)
    document.removeEventListener("keyup", this.onKeyUp)
    window.removeEventListener("resize", this.onResize)
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock()
    this.renderer.dispose()
    if (this.container.contains(this.renderer.domElement)) this.container.removeChild(this.renderer.domElement)
  }

  // ── Level loaders ──────────────────────────────────────────────────────────

  loadLevel(id: LevelId) {
    // Clear previous
    while (this.scene.children.length) this.scene.remove(this.scene.children[0])
    this.scene.add(this.camera)
    this.scene.add(this.creature)
    this.walkRects = []
    this.obstacles = []
    this.hideSpots = []
    this.collectibles = []
    this.exitCfg = null
    this.exitActive = false
    this.inventory.clear()
    this.dead = false
    this.won = false
    this.levelDone = false
    this.isHiding = false
    this.activeHideSpot = null
    this.stamina = 100
    this.fear = 0
    this.currentLevel = id

    const meta = LEVEL_META[id]
    this.scene.background = new THREE.Color(meta.skyHex)
    this.scene.fog = new THREE.FogExp2(meta.skyHex, meta.fogDensity)
    this.creatureSpeed = meta.creatureSpeed
    this.visionRange = meta.visionRange
    this.hearingRadius = meta.hearingRadius

    const ambient = new THREE.AmbientLight(meta.ambientHex, meta.ambientIntensity)
    this.scene.add(ambient)

    if (id === 1) this.buildLevel1()
    else if (id === 2) this.buildLevel2()
    else this.buildLevel3()

    // Re-add flashlight after scene clear
    this.flashlight.visible = this.flashlightOn
  }

  // ── Level 1: El Bosque Olvidado ────────────────────────────────────────────

  private buildLevel1() {
    const moon = new THREE.DirectionalLight(0x3344aa, 1.8)
    moon.position.set(-15, 30, 20)
    this.scene.add(moon)

    // Ground
    addFloor(this.scene, 0, 0, 200, 200, 0x1a3018)

    // Trees
    const rng = mulberry32(42)
    for (let i = 0; i < 240; i++) {
      const angle = rng() * Math.PI * 2
      const minR = i < 40 ? 5 : 8
      const radius = minR + rng() * 50
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      // Avoid clearing around items
      const clear = [[12, 6], [-18, 10], [5, -20], [0, -35], [8, 12]].some(([cx, cz]) => Math.hypot(x - cx, z - cz) < 3)
      if (clear) continue
      buildTree(this.scene, x, z)
      this.obstacles.push({ px: x, pz: z, r: 0.35 })
    }

    // Hide spot: hollow log at [8, 12]
    const logGroup = new THREE.Group()
    const logMat = new THREE.MeshLambertMaterial({ color: 0x2a1e12 })
    const logMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 4, 8), logMat)
    logMesh.rotation.z = Math.PI / 2
    logMesh.position.set(0, 0.6, 0)
    logGroup.add(logMesh)
    logGroup.position.set(8, 0, 12)
    this.scene.add(logGroup)
    this.hideSpots.push({
      pos: new THREE.Vector3(8, 0, 12),
      camPos: new THREE.Vector3(8, 0.5, 12),
      radius: 1.5,
      occupied: false,
    })

    // Collectibles: 3 ritual keys
    const keyPositions: [number, number][] = [[14, 8], [-18, 10], [5, -20]]
    keyPositions.forEach(([x, z], i) => {
      const glow = new THREE.PointLight(0xffaa22, 3, 8)
      glow.position.set(x, 1.2, z)
      this.scene.add(glow)

      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.15, 0.04, 8, 16),
        new THREE.MeshBasicMaterial({ color: 0xffcc44 })
      )
      mesh.position.set(x, 1.1, z)
      this.scene.add(mesh)

      this.collectibles.push({
        id: `key_${i}`, type: "key", mesh, pos: new THREE.Vector3(x, 1.1, z), collected: false,
        note: i === 0 ? { title: "LLAVE RITUAL — NOTA ADJUNTA", text: "Esta llave tiene grabados que no reconozco.\nSon más antiguos que cualquier lengua conocida.\n\nEncuentra las otras dos.\nLa puerta solo se abre con las tres juntas.\n\n— M.V." } : undefined,
      })
    })

    // Rock formation (lore note)
    const noteMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xe2d8b0, side: THREE.DoubleSide })
    )
    noteMesh.position.set(-5, 1.0, 8)
    this.scene.add(noteMesh)
    this.collectibles.push({
      id: "note_forest_1", type: "note", mesh: noteMesh,
      pos: new THREE.Vector3(-5, 1.0, 8), collected: false,
      note: {
        title: "DIARIO — ENTRADA 3",
        text: "Llevo tres días en el bosque.\nLos senderos cambian de noche.\nNo es posible, pero lo hacen.\n\nVi algo entre los árboles anoche.\nNo era humano. Las proporciones están mal.\nDemasiado alto. Demasiado delgado.\n\nNo emitió ningún sonido.\nSolo... me miró.\n\nSigo escuchando pasos cuando me detengo.",
      },
    })

    // Exit gate
    const exitLight = new THREE.PointLight(0xff3311, 0, 12)
    exitLight.position.set(0, 2, -35)
    this.scene.add(exitLight)

    const gateGeo = new THREE.BoxGeometry(3, 4, 0.3)
    const gateMat = new THREE.MeshBasicMaterial({ color: 0xff4422, transparent: true, opacity: 0 })
    const gate = new THREE.Mesh(gateGeo, gateMat)
    gate.position.set(0, 2, -35)
    this.scene.add(gate)

    // Gate pillars
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x2a2018 })
    ;[-1.8, 1.8].forEach(ox => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 0.4), pillarMat)
      p.position.set(ox, 2.5, -35)
      this.scene.add(p)
    })

    this.exitCfg = {
      pos: new THREE.Vector3(0, 0, -35),
      radius: 2.5,
      needItems: ["key_0", "key_1", "key_2"],
      mesh: gate,
      light: exitLight,
    }

    // Creature
    this.waypoints = [
      new THREE.Vector3(20, 0, 15), new THREE.Vector3(-15, 0, 20),
      new THREE.Vector3(-20, 0, -10), new THREE.Vector3(10, 0, -20),
      new THREE.Vector3(25, 0, 5),
    ]
    this.cPos.set(28, 0, 28)
    this.creature.position.copy(this.cPos)
    this.waypointIdx = 0
    this.creatureState = "patrol"

    // Player start
    this.playerPos.set(0, 0, 5)
    this.camera.position.set(0, 1.7, 5)
    this.yaw = 0
    this.pitch = 0
  }

  // ── Level 2: Sanatorio Arkham ──────────────────────────────────────────────

  private buildLevel2() {
    // Dim point lights around the level
    const warmLight = new THREE.PointLight(0x3a1a1a, 4, 30)
    warmLight.position.set(0, 3, 5)
    this.scene.add(warmLight)

    const H = 3.2  // ceiling height
    const FLOOR = 0x0d0b0b
    const CEIL = 0x080606
    const WALL = 0x120e0e

    // ── Rooms definition (cx, cz, hw, hd) ──
    const rooms: WalkRect[] = [
      { cx: 0, cz: 0, hw: 6, hd: 4 },         // Lobby (player start)
      { cx: 0, cz: 8, hw: 2, hd: 4 },          // Central corridor
      { cx: -9, cz: 10, hw: 5, hd: 4 },        // Ward
      { cx: 9, cz: 10, hw: 5, hd: 4 },         // Operating room
      { cx: -3, cz: 8, hw: 1, hd: 2 },         // Connector left
      { cx: 3, cz: 8, hw: 1, hd: 2 },          // Connector right
      { cx: 0, cz: 16, hw: 2, hd: 4 },         // Upper corridor
      { cx: -9, cz: 20, hw: 5, hd: 4 },        // Generator room
      { cx: 9, cz: 20, hw: 5, hd: 4 },         // Office
      { cx: -3, cz: 17, hw: 1, hd: 2 },        // Gen connector
      { cx: 3, cz: 17, hw: 1, hd: 2 },         // Office connector
      { cx: 0, cz: 24, hw: 2, hd: 4 },         // Exit corridor
      { cx: 0, cz: 29, hw: 4, hd: 3 },         // Exit room
    ]
    this.walkRects = rooms

    // Build floors + ceilings + perimeter walls for each room
    for (const r of rooms) {
      addFloor(this.scene, r.cx, r.cz, r.hw * 2, r.hd * 2, FLOOR)
      addCeiling(this.scene, r.cx, r.cz, r.hw * 2, r.hd * 2, H, CEIL)
      // 4 walls (will overlap but fine visually)
      addWall(this.scene, r.cx, H / 2, r.cz - r.hd, r.hw * 2, H, 0, WALL)  // north
      addWall(this.scene, r.cx, H / 2, r.cz + r.hd, r.hw * 2, H, Math.PI, WALL)  // south
      addWall(this.scene, r.cx - r.hw, H / 2, r.cz, r.hd * 2, H, Math.PI / 2, WALL)  // west
      addWall(this.scene, r.cx + r.hw, H / 2, r.cz, r.hd * 2, H, -Math.PI / 2, WALL)  // east
    }

    // Ceiling flickering light in ward
    const wardLight = new THREE.PointLight(0x1a0505, 1.5, 12)
    wardLight.position.set(-9, 3, 10)
    this.scene.add(wardLight)

    // Generator room light
    const genLight = new THREE.PointLight(0x0a1a0a, 1.2, 10)
    genLight.position.set(-9, 3, 20)
    this.scene.add(genLight)

    // Hide spots: lockers in ward and corridor
    ;[
      { pos: new THREE.Vector3(-12, 0, 10), cam: new THREE.Vector3(-12.5, 1.4, 10) },
      { pos: new THREE.Vector3(0, 0, 13), cam: new THREE.Vector3(0, 1.4, 12.5) },
    ].forEach(({ pos, cam }) => {
      const locker = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 2.2, 0.4),
        new THREE.MeshLambertMaterial({ color: 0x1a1212 })
      )
      locker.position.copy(pos).setY(1.1)
      this.scene.add(locker)
      this.hideSpots.push({ pos, camPos: cam, radius: 1.2, occupied: false })
    })

    // Collectibles
    // Generator item (clue)
    const genMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffaa00 })
    )
    genMesh.position.set(-9, 0.8, 20)
    this.scene.add(genMesh)
    this.collectibles.push({
      id: "generator", type: "clue", mesh: genMesh,
      pos: new THREE.Vector3(-9, 0.8, 20), collected: false,
      note: {
        title: "GENERADOR ACTIVADO",
        text: "Pulsas el interruptor.\nEl generador tose y escupe a la vida.\nLas luces parpadean en algún lugar arriba.\n\nEscuchas algo moverse en el pasillo.\n\nRápido. Encuentra la tarjeta.",
      },
    })

    // Keycard in office
    const cardMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.02, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x3388ff })
    )
    cardMesh.position.set(9, 0.9, 20)
    this.scene.add(cardMesh)
    this.collectibles.push({
      id: "keycard", type: "keycard", mesh: cardMesh,
      pos: new THREE.Vector3(9, 0.9, 20), collected: false,
      note: {
        title: "TARJETA DE ACCESO",
        text: "HOSPITAL PSIQUIÁTRICO ARKHAM\nTARJETA DE PERSONAL — NIVEL 3\n\nDr. Elias Mora\nDepartamento de Terapia Experimental\n\nEsta tarjeta abre la salida principal.\nEl Dr. Mora no la necesitará ya.",
      },
    })

    // Lore note in operating room
    const noteMesh1 = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xe2d8b0, side: THREE.DoubleSide })
    )
    noteMesh1.position.set(9, 1.2, 8)
    this.scene.add(noteMesh1)
    this.collectibles.push({
      id: "note_asylum_1", type: "note", mesh: noteMesh1,
      pos: new THREE.Vector3(9, 1.2, 8), collected: false,
      note: {
        title: "INFORME DE INCIDENTE — ARKHAM",
        text: "Paciente 47 fue encontrado en el pasillo norte a las 3:17 AM.\n\nNo estaba dormido. No estaba despierto.\nSus ojos estaban abiertos pero miraban...\ndetrás de nosotros.\n\nCuando le preguntamos qué veía, solo dijo:\n\n'Todavía está aquí. Siempre está aquí.'\n\nEl Paciente 47 falleció esa misma noche.",
      },
    })

    // Lore note in lobby
    const noteMesh2 = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xe2d8b0, side: THREE.DoubleSide })
    )
    noteMesh2.position.set(2, 1.2, -2)
    this.scene.add(noteMesh2)
    this.collectibles.push({
      id: "note_asylum_2", type: "note", mesh: noteMesh2,
      pos: new THREE.Vector3(2, 1.2, -2), collected: false,
      note: {
        title: "NOTA PERSONAL — Dr. Mora",
        text: "El experimento salió mal. Lo sé.\nPero lo que emergió no debería existir.\n\nNo podemos matarlo.\nHemos intentado todo.\n\nSolo se puede... evitar.\nNo hagas ruido. No corras.\nSi te ve, ya es tarde.\n\nDios, por qué hicimos esto.",
      },
    })

    // Exit door
    const exitLight = new THREE.PointLight(0x0033ff, 0, 6)
    exitLight.position.set(0, 2, 32)
    this.scene.add(exitLight)

    const doorMat = new THREE.MeshBasicMaterial({ color: 0x2244cc, transparent: true, opacity: 0 })
    const door = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2), doorMat)
    door.position.set(0, 1.5, 32)
    this.scene.add(door)

    this.exitCfg = {
      pos: new THREE.Vector3(0, 0, 32),
      radius: 2,
      needItems: ["generator", "keycard"],
      mesh: door,
      light: exitLight,
    }

    // Creature
    this.waypoints = [
      new THREE.Vector3(-9, 0, 10), new THREE.Vector3(0, 0, 8),
      new THREE.Vector3(9, 0, 10), new THREE.Vector3(0, 0, 16),
      new THREE.Vector3(-9, 0, 20), new THREE.Vector3(9, 0, 20),
    ]
    this.cPos.set(-9, 0, 10)
    this.creature.position.copy(this.cPos)
    this.waypointIdx = 0
    this.creatureState = "patrol"

    // Player start
    this.playerPos.set(0, 0, -2)
    this.camera.position.set(0, 1.7, -2)
    this.yaw = 0
    this.pitch = 0
  }

  // ── Level 3: Las Catacumbas ────────────────────────────────────────────────

  private buildLevel3() {
    const H = 2.8
    const FLOOR = 0x0a0808
    const CEIL = 0x060404
    const WALL = 0x0e0a0a

    // Drip-like point lights scattered
    ;[
      [0, 0], [0, 12], [-5, 18], [0, 28], [5, 28], [0, 40], [0, 50],
    ].forEach(([x, z]) => {
      const l = new THREE.PointLight(0x0a0510, 1.5 + Math.random(), 8)
      l.position.set(x, H - 0.3, z)
      this.scene.add(l)
    })

    // ── Tunnel layout ──
    const rooms: WalkRect[] = [
      { cx: 0, cz: 0, hw: 2.5, hd: 2.5 },      // Start chamber
      { cx: 0, cz: 8, hw: 1.8, hd: 6 },         // Tunnel N
      { cx: -5, cz: 13, hw: 3, hd: 2 },         // Left branch
      { cx: 5, cz: 13, hw: 3, hd: 2 },          // Right branch (HIDE ALCOVE)
      { cx: -2, cz: 13, hw: 1.2, hd: 1.5 },     // Left connector
      { cx: 2, cz: 13, hw: 1.2, hd: 1.5 },      // Right connector
      { cx: 0, cz: 22, hw: 1.8, hd: 6 },        // Tunnel continuing
      { cx: -4, cz: 26, hw: 2.5, hd: 2.5 },     // Left alcove (HIDE)
      { cx: -2, cz: 26, hw: 1.2, hd: 1 },       // Alcove connector
      { cx: 0, cz: 32, hw: 2, hd: 3 },          // Chamber
      { cx: 0, cz: 40, hw: 1.8, hd: 6 },        // Final tunnel
      { cx: 0, cz: 48, hw: 3.5, hd: 3.5 },      // Exit chamber
    ]
    this.walkRects = rooms

    for (const r of rooms) {
      addFloor(this.scene, r.cx, r.cz, r.hw * 2, r.hd * 2, FLOOR)
      addCeiling(this.scene, r.cx, r.cz, r.hw * 2, r.hd * 2, H, CEIL)
      addWall(this.scene, r.cx, H / 2, r.cz - r.hd, r.hw * 2, H, 0, WALL)
      addWall(this.scene, r.cx, H / 2, r.cz + r.hd, r.hw * 2, H, Math.PI, WALL)
      addWall(this.scene, r.cx - r.hw, H / 2, r.cz, r.hd * 2, H, Math.PI / 2, WALL)
      addWall(this.scene, r.cx + r.hw, H / 2, r.cz, r.hd * 2, H, -Math.PI / 2, WALL)
    }

    // Stalactites (decorative cylinders hanging from ceiling)
    const stalMat = new THREE.MeshLambertMaterial({ color: 0x080606 })
    for (let i = 0; i < 30; i++) {
      const r = rooms[Math.floor(Math.random() * rooms.length)]
      const x = r.cx + (Math.random() - 0.5) * r.hw * 1.5
      const z = r.cz + (Math.random() - 0.5) * r.hd * 1.5
      const len = 0.4 + Math.random() * 0.8
      const stal = new THREE.Mesh(new THREE.ConeGeometry(0.06, len, 5), stalMat)
      stal.position.set(x, H - len / 2, z)
      stal.rotation.z = Math.PI
      this.scene.add(stal)
    }

    // Hide spots: alcoves
    ;[
      { pos: new THREE.Vector3(5, 0, 13), cam: new THREE.Vector3(6.5, 1.3, 13) },
      { pos: new THREE.Vector3(-4, 0, 26), cam: new THREE.Vector3(-5.5, 1.3, 26) },
    ].forEach(({ pos, cam }) => {
      const alcoveMark = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 2.2, 1.5),
        new THREE.MeshLambertMaterial({ color: 0x0f0c0c })
      )
      alcoveMark.position.copy(pos).setY(1.1)
      this.scene.add(alcoveMark)
      this.hideSpots.push({ pos, camPos: cam, radius: 1.5, occupied: false })
    })

    // Code = "4-7-3"
    // Note 1: "4"
    const makeNote = (x: number, z: number, id: string, note: { title: string; text: string }) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.28, 0.36),
        new THREE.MeshBasicMaterial({ color: 0xddd0b0, side: THREE.DoubleSide })
      )
      m.position.set(x, 1.2, z)
      this.scene.add(m)
      this.collectibles.push({ id, type: "note", mesh: m, pos: new THREE.Vector3(x, 1.2, z), collected: false, note })
    }

    makeNote(-5, 13, "code_1", {
      title: "PAPEL RASGADO — FRAGMENTO A",
      text: "El código de la puerta...\nlo dividimos para que nadie lo recordara completo.\n\nMi número es el 4.\n\nDios nos ayude a todos si alguien llega tan lejos.",
    })
    makeNote(5, 13, "code_2", {
      title: "PAPEL RASGADO — FRAGMENTO B",
      text: "Si encontraste el primer fragmento,\naquí está el segundo dígito: 7\n\nY si lo estás leyendo...\nél también lo sabe.\nTe está siguiendo ahora mismo.",
    })
    makeNote(0, 32, "code_3", {
      title: "PAPEL RASGADO — FRAGMENTO C",
      text: "El tercer dígito es 3.\n\n4-7-3\n\nLa puerta está al final del último túnel.\nCorre.\nNo mires atrás.\nNO MIRES ATRÁS.",
    })

    makeNote(0, 22, "note_cave_lore", {
      title: "GRABADO EN LA PARED",
      text: "Hay marcas en esta roca.\nNo son humanas. Son demasiado... regulares.\nDemasiado precisas para una mano.\n\nLlevo aquí días. O semanas. No lo sé.\nEl tiempo no fluye igual bajo tierra.\n\nLo escucho respirar.\nAunque sé que no respira.",
    })

    // Exit vault door
    const exitLight = new THREE.PointLight(0xdd2200, 0, 8)
    exitLight.position.set(0, 2, 51)
    this.scene.add(exitLight)

    const vaultMat = new THREE.MeshLambertMaterial({ color: 0x1a0a08 })
    const vault = new THREE.Mesh(new THREE.BoxGeometry(4, H, 0.5), vaultMat)
    vault.position.set(0, H / 2, 51.5)
    this.scene.add(vault)

    const vaultOpen = new THREE.Mesh(
      new THREE.BoxGeometry(2, H - 0.5, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0 })
    )
    vaultOpen.position.set(0, H / 2, 51)
    this.scene.add(vaultOpen)

    this.exitCfg = {
      pos: new THREE.Vector3(0, 0, 51),
      radius: 2.5,
      needItems: ["code_1", "code_2", "code_3"],
      mesh: vaultOpen,
      light: exitLight,
    }

    // Creature: faster, more aggressive
    this.waypoints = [
      new THREE.Vector3(0, 0, 8), new THREE.Vector3(-5, 0, 13),
      new THREE.Vector3(5, 0, 13), new THREE.Vector3(0, 0, 22),
      new THREE.Vector3(0, 0, 32), new THREE.Vector3(0, 0, 40),
    ]
    this.cPos.set(0, 0, 48)
    this.creature.position.copy(this.cPos)
    this.waypointIdx = 0
    this.creatureState = "patrol"

    // Player start
    this.playerPos.set(0, 0, -1)
    this.camera.position.set(0, 1.7, -1)
    this.yaw = 0
    this.pitch = 0
  }

  // Public getters for React
  getLevel(): LevelId { return this.currentLevel }
  getLevelMeta() { return LEVEL_META[this.currentLevel] }
  getInventory() { return Array.from(this.inventory) }
  getCollectibles() { return this.collectibles }
  isExitActive() { return this.exitActive }
}

// Seeded RNG (Mulberry32)
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
