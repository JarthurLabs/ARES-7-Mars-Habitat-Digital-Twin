import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ModuleDefinition, Telemetry } from "./types";

export const MODULES: readonly ModuleDefinition[] = [
  {
    id: "command-01",
    label: "Command",
    code: "CMD-01",
    kind: "command",
    position: [0, 1.4, 0],
    criticality: "mission",
  },
  {
    id: "hab-01",
    label: "Crew Habitat",
    code: "HAB-01",
    kind: "habitat",
    position: [-7.2, 1.25, 1.1],
    criticality: "crew",
  },
  {
    id: "lss-01",
    label: "Life Support",
    code: "LSS-01",
    kind: "life-support",
    position: [6.9, 1.15, 1.4],
    criticality: "mission",
  },
  {
    id: "greenhouse-01",
    label: "Greenhouse",
    code: "GRN-01",
    kind: "greenhouse",
    position: [-4.7, 1.05, -6.4],
    criticality: "support",
  },
  {
    id: "power-01",
    label: "Power Control",
    code: "PWR-01",
    kind: "power",
    position: [5.2, 0.95, -6.4],
    criticality: "mission",
  },
  {
    id: "airlock-02",
    label: "External Airlock",
    code: "AIR-02",
    kind: "airlock",
    position: [0.2, 0.8, 6.1],
    criticality: "crew",
  },
];

interface HabitatSceneOptions {
  container: HTMLElement;
  onSelect: (module: ModuleDefinition) => void;
}

const STATUS_COLORS = {
  nominal: new THREE.Color(0x43f0bd),
  warning: new THREE.Color(0xf5b642),
  critical: new THREE.Color(0xff5d57),
  isolated: new THREE.Color(0x7a8990),
};

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 999.13) * 43758.5453;
  return x - Math.floor(x);
}

function material(color: number, metalness = 0.72, roughness = 0.34): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

export class HabitatScene {
  private readonly container: HTMLElement;
  private readonly onSelect: HabitatSceneOptions["onSelect"];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(44, 1, 0.1, 500);
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly moduleGroups = new Map<string, THREE.Group>();
  private readonly statusRings = new Map<string, THREE.Mesh>();
  private readonly beaconLights = new Map<string, THREE.PointLight>();
  private readonly storm: THREE.Points;
  private readonly resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private disposed = false;
  private currentTelemetry: Telemetry | null = null;
  private readonly reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor({ container, onSelect }: HabitatSceneOptions) {
    this.container = container;
    this.onSelect = onSelect;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional ARES-7 habitat");
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute("aria-describedby", "scene-keyboard-help");
    this.renderer.domElement.tabIndex = 0;
    this.container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x160d0a);
    this.scene.fog = new THREE.FogExp2(0x2b130d, 0.012);
    this.camera.position.set(18, 16, 22);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.minDistance = 13;
    this.controls.maxDistance = 46;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.target.set(0, 0.5, -0.4);

    this.addLighting();
    this.addTerrain();
    this.addHabitat();
    this.addSolarArrays();
    this.storm = this.createStorm();
    this.scene.add(this.storm);

    this.renderer.domElement.addEventListener("pointerup", this.handlePointer);
    this.renderer.domElement.addEventListener("keydown", this.handleKeyboard);
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  private addLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xffc29a, 0x1c1512, 1.75);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xffc69d, 4.2);
    sun.position.set(-16, 24, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    this.scene.add(sun);

    const horizon = new THREE.DirectionalLight(0xff5e2f, 1.2);
    horizon.position.set(18, 4, -24);
    this.scene.add(horizon);
  }

  private addTerrain(): void {
    const geometry = new THREE.PlaneGeometry(120, 120, 80, 80);
    const position = geometry.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const distance = Math.sqrt(x * x + y * y);
      const rolling = Math.sin(x * 0.16) * 0.36 + Math.cos(y * 0.13) * 0.28;
      const detail = (seededRandom(index + 44) - 0.5) * 0.48;
      const flattenedBase = distance < 17 ? -0.22 : rolling + detail;
      position.setZ(index, flattenedBase);
    }
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0x6e291b, roughness: 0.95, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    for (let index = 0; index < 54; index += 1) {
      const angle = seededRandom(index + 1) * Math.PI * 2;
      const radius = 18 + seededRandom(index + 91) * 37;
      const scale = 0.18 + seededRandom(index + 122) * 1.15;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(scale, 0),
        new THREE.MeshStandardMaterial({ color: 0x512117, roughness: 1 }),
      );
      rock.position.set(Math.cos(angle) * radius, scale * 0.34, Math.sin(angle) * radius);
      rock.rotation.set(angle * 0.3, angle, -angle * 0.17);
      rock.scale.y = 0.55 + seededRandom(index + 8) * 0.35;
      rock.castShadow = true;
      this.scene.add(rock);
    }

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(14, 14.7, 0.34, 64),
      new THREE.MeshStandardMaterial({ color: 0x252a2b, roughness: 0.72, metalness: 0.5 }),
    );
    pad.position.y = 0.02;
    pad.receiveShadow = true;
    this.scene.add(pad);

    const padRing = new THREE.Mesh(
      new THREE.TorusGeometry(13.3, 0.07, 8, 96),
      new THREE.MeshBasicMaterial({ color: 0xdd6b3b }),
    );
    padRing.rotation.x = Math.PI / 2;
    padRing.position.y = 0.22;
    this.scene.add(padRing);
  }

  private addHabitat(): void {
    this.addCorridor([-3.65, 0.65, 0.55], [4.2, 0.7, 1.15], 0);
    this.addCorridor([3.55, 0.65, 0.68], [4, 0.7, 1.15], 0);
    this.addCorridor([-2.35, 0.6, -3.35], [1.15, 0.65, 5.2], -0.62);
    this.addCorridor([2.6, 0.6, -3.2], [1.15, 0.65, 5], 0.62);
    this.addCorridor([0.1, 0.58, 3.15], [1.25, 0.7, 4.1], 0);

    MODULES.forEach((definition) => this.createModule(definition));
  }

  private addCorridor(
    position: readonly [number, number, number],
    dimensions: readonly [number, number, number],
    rotationY: number,
  ): void {
    const corridor = new THREE.Mesh(
      new THREE.BoxGeometry(...dimensions),
      new THREE.MeshStandardMaterial({ color: 0x929b9c, metalness: 0.86, roughness: 0.29 }),
    );
    corridor.position.set(...position);
    corridor.rotation.y = rotationY;
    corridor.castShadow = true;
    corridor.receiveShadow = true;
    this.scene.add(corridor);

    const light = new THREE.Mesh(
      new THREE.BoxGeometry(dimensions[0] * 0.72, 0.05, dimensions[2] * 0.72),
      new THREE.MeshBasicMaterial({ color: 0x54dcb7 }),
    );
    light.position.copy(corridor.position);
    light.position.y += dimensions[1] / 2 + 0.03;
    light.rotation.y = rotationY;
    this.scene.add(light);
  }

  private createModule(definition: ModuleDefinition): void {
    const group = new THREE.Group();
    group.position.set(...definition.position);
    group.userData.moduleId = definition.id;

    const sizes: Record<ModuleDefinition["kind"], readonly [number, number]> = {
      command: [3.9, 2.15],
      habitat: [3.4, 1.9],
      "life-support": [3.1, 1.75],
      greenhouse: [3.6, 1.55],
      power: [2.9, 1.45],
      airlock: [2.3, 1.2],
    };
    const [radius, height] = sizes[definition.kind];
    const hullColor = definition.kind === "greenhouse" ? 0x607a68 : 0xb9c0bd;
    const hull = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: hullColor,
        metalness: definition.kind === "greenhouse" ? 0.25 : 0.78,
        roughness: 0.28,
        transparent: definition.kind === "greenhouse",
        opacity: definition.kind === "greenhouse" ? 0.78 : 1,
      }),
    );
    hull.scale.y = height / radius;
    hull.castShadow = true;
    hull.receiveShadow = true;
    hull.userData.moduleId = definition.id;
    group.add(hull);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.96, radius * 1.03, 0.52, 48),
      material(0x555d5d, 0.84, 0.31),
    );
    base.position.y = -0.16;
    base.castShadow = true;
    base.userData.moduleId = definition.id;
    group.add(base);

    const band = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.8, 0.09, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0xf0824f }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.05;
    band.userData.moduleId = definition.id;
    group.add(band);

    if (definition.kind === "greenhouse") {
      const plants = new THREE.Group();
      for (let index = 0; index < 15; index += 1) {
        const plant = new THREE.Mesh(
          new THREE.ConeGeometry(0.13, 0.42, 6),
          new THREE.MeshStandardMaterial({ color: index % 3 === 0 ? 0x8fd46d : 0x3d9b58 }),
        );
        const angle = (index / 15) * Math.PI * 2;
        const ring = 0.65 + (index % 3) * 0.48;
        plant.position.set(Math.cos(angle) * ring, 0.22, Math.sin(angle) * ring);
        plants.add(plant);
      }
      group.add(plants);
    }

    const statusRing = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.08, 0.07, 8, 64),
      new THREE.MeshBasicMaterial({ color: STATUS_COLORS.nominal, transparent: true, opacity: 0.95 }),
    );
    statusRing.rotation.x = Math.PI / 2;
    statusRing.position.y = -0.3;
    statusRing.userData.moduleId = definition.id;
    group.add(statusRing);
    this.statusRings.set(definition.id, statusRing);

    const beacon = new THREE.PointLight(STATUS_COLORS.nominal, 1.8, 6, 2);
    beacon.position.y = height + 0.5;
    group.add(beacon);
    this.beaconLights.set(definition.id, beacon);

    this.moduleGroups.set(definition.id, group);
    this.scene.add(group);
  }

  private addSolarArrays(): void {
    const positions: ReadonlyArray<readonly [number, number, number, number]> = [
      [-12.8, 0.75, -8, 0.2],
      [-12.6, 0.75, -11.3, 0.2],
      [12.4, 0.75, -8.1, -0.18],
      [12.7, 0.75, -11.4, -0.18],
    ];

    positions.forEach(([x, y, z, rotation]) => {
      const assembly = new THREE.Group();
      assembly.position.set(x, y, z);
      assembly.rotation.y = rotation;

      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(6.4, 0.12, 2.4),
        new THREE.MeshStandardMaterial({ color: 0x153a50, metalness: 0.72, roughness: 0.24 }),
      );
      panel.rotation.x = -0.19;
      panel.castShadow = true;
      assembly.add(panel);

      for (let column = -2; column <= 2; column += 1) {
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(0.025, 0.02, 2.35),
          new THREE.MeshBasicMaterial({ color: 0x5c8ca2 }),
        );
        line.position.x = column * 1.08;
        line.position.y = 0.075;
        line.rotation.x = -0.19;
        assembly.add(line);
      }

      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.3, 12), material(0x505859));
      stand.position.y = -0.62;
      assembly.add(stand);
      this.scene.add(assembly);
    });
  }

  private createStorm(): THREE.Points {
    const count = 2600;
    const positions = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (seededRandom(index + 701) - 0.5) * 75;
      positions[index * 3 + 1] = seededRandom(index + 1101) * 23;
      positions[index * 3 + 2] = (seededRandom(index + 1501) - 0.5) * 75;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const stormMaterial = new THREE.PointsMaterial({
      color: 0xe18355,
      size: 0.09,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return new THREE.Points(geometry, stormMaterial);
  }

  setTelemetry(telemetry: Telemetry): void {
    this.currentTelemetry = telemetry;
    const severity = telemetry.phase === "degraded" ? "critical" : telemetry.phase === "storm" ? "warning" : "nominal";
    MODULES.forEach((module) => {
      let moduleStatus: keyof typeof STATUS_COLORS = severity;
      if (module.kind === "greenhouse" && telemetry.greenhouseIsolated) moduleStatus = "isolated";
      if (module.kind === "airlock" && telemetry.airlockSealed) moduleStatus = "nominal";
      if (module.kind === "power" && telemetry.emergencyBusActive) moduleStatus = "warning";
      const color = STATUS_COLORS[moduleStatus];
      const ringMaterial = this.statusRings.get(module.id)?.material as THREE.MeshBasicMaterial | undefined;
      if (ringMaterial) ringMaterial.color.copy(color);
      const beacon = this.beaconLights.get(module.id);
      if (beacon) beacon.color.copy(color);
    });

    const stormMaterial = this.storm.material as THREE.PointsMaterial;
    stormMaterial.opacity = 0.03 + telemetry.dustOpacityPercent / 165;
    this.scene.fog = new THREE.FogExp2(
      telemetry.dustOpacityPercent > 70 ? 0x5e2a1a : 0x2b130d,
      0.009 + telemetry.dustOpacityPercent / 4800,
    );
  }

  focusModule(moduleId: string): void {
    const group = this.moduleGroups.get(moduleId);
    if (!group) return;
    this.controls.target.copy(group.position).setY(0.8);
    const offset = new THREE.Vector3(8, 7, 9);
    this.camera.position.copy(group.position).add(offset);
  }

  resetView(): void {
    this.controls.target.set(0, 0.5, -0.4);
    this.camera.position.set(18, 16, 22);
  }

  private readonly handlePointer = (event: PointerEvent): void => {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects([...this.moduleGroups.values()], true);
    const moduleId = intersections.find(({ object }) => Boolean(object.userData.moduleId))?.object.userData
      .moduleId as string | undefined;
    const selected = MODULES.find(({ id }) => id === moduleId);
    if (selected) {
      this.focusModule(selected.id);
      this.onSelect(selected);
    }
  };

  private readonly handleKeyboard = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      this.resetView();
    }
  };

  private readonly resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private readonly animate = (): void => {
    if (this.disposed) return;
    const elapsed = this.clock.getElapsedTime();
    const speed = 0.03 + (this.currentTelemetry?.dustOpacityPercent ?? 4) / 900;
    if (!this.reduceMotion) {
      this.storm.position.x = (elapsed * speed * 25) % 18;
      this.storm.rotation.y = elapsed * 0.006;
    }

    this.beaconLights.forEach((light, id) => {
      const offset = MODULES.findIndex((module) => module.id === id) * 0.7;
      light.intensity = this.reduceMotion ? 1.75 : 1.3 + (Math.sin(elapsed * 2.2 + offset) + 1) * 0.45;
    });

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointer);
    this.renderer.domElement.removeEventListener("keydown", this.handleKeyboard);
    this.renderer.dispose();
  }
}
