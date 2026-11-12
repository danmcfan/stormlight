import * as THREE from 'three';

/** Roshar daylight: pale sky, warm low sun, long hard shadows. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  private sunOffset = new THREE.Vector3(-38, 55, -22);

  constructor(scene: THREE.Scene) {
    const sky = new THREE.Color('#a9bccd');
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, 70, 320);

    scene.add(new THREE.HemisphereLight('#cfe0f0', '#5a4636', 1.15));

    this.sun = new THREE.DirectionalLight('#fff1dc', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -35; c.right = 35; c.top = 35; c.bottom = -35; c.near = 1; c.far = 160;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    // A big gradient dome so the horizon reads as sky, not a flat colour.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color('#5f86b0') }, horizon: { value: sky } },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y*2.2, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, h), 1.0); }',
      }),
    );
    dome.renderOrder = -1;
    scene.add(dome);

    // The chasm floor far below, lost in haze.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshLambertMaterial({ color: '#3b3a36' }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -70;
    scene.add(floor);
  }

  /** Keep the shadow frustum centred on the player for crisp shadows. */
  follow(target: THREE.Vector3): void {
    this.sun.position.copy(target).add(this.sunOffset);
    this.sun.target.position.copy(target);
  }
}
