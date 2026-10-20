// Integration harness only: real scene math with a renderer stand-in, no GPU claims.
export * from "three";
export class WebGLRenderer {
  constructor() {
    this.info = { render: { calls: 0 } };
  }
  setPixelRatio() {}
  setSize() {}
  render(scene, camera) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    this.info.render.calls++;
  }
}
