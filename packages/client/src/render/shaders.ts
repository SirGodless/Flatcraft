import { Filter, GlProgram } from "pixi.js";

/**
 * Named shader/filter effects, applied to item and mob world-sprites via a
 * def's `visual.shader.id` (see registry/schema.ts's VisualJson) - same
 * "unknown id -> no effect, never an error" rule as everywhere else sprite
 * data is looked up. WebGL-only for now (see renderer.ts's Application.init
 * `preference: "webgl"`): PixiJS v8 filters need a glProgram and/or a
 * gpuProgram, and writing both would double the GLSL/WGSL maintenance for
 * no current benefit.
 */

/** Standard passthrough vertex shader shared by every filter here -
 * identical in spirit to PixiJS's own built-in filters, just inlined since
 * the package doesn't expose it as a public import. */
const VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void)
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void)
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}`;

const SHIMMER_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a <= 0.0) {
        finalColor = color;
        return;
    }
    float wave = sin((vTextureCoord.x + vTextureCoord.y) * 10.0 + uTime * uSpeed);
    float shine = smoothstep(0.6, 1.0, wave) * uIntensity;
    finalColor = vec4(color.rgb + shine, color.a);
}`;

/** A registered filter that also knows how to advance its own animated
 * uniforms - the draw loop calls setTime() once per frame, same idea as
 * EntityAnimationView's manual per-frame texture swap. */
export interface ShaderEffect extends Filter {
  setTime(now: number): void;
}

class ShimmerFilter extends Filter implements ShaderEffect {
  constructor(params?: Record<string, number | string | boolean>) {
    const speed = typeof params?.["speed"] === "number" ? params["speed"] : 3;
    const intensity = typeof params?.["intensity"] === "number" ? params["intensity"] : 0.35;
    super({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: SHIMMER_FRAGMENT, name: "shimmer-filter" }),
      resources: {
        shimmerUniforms: {
          uTime: { value: 0, type: "f32" },
          uSpeed: { value: speed, type: "f32" },
          uIntensity: { value: intensity, type: "f32" },
        },
      },
    });
  }

  setTime(now: number): void {
    this.resources["shimmerUniforms"].uniforms.uTime = now / 1000;
    this.resources["shimmerUniforms"].update();
  }
}

const REGISTRY: Record<string, (params?: Record<string, number | string | boolean>) => ShaderEffect> = {
  shimmer: (params) => new ShimmerFilter(params),
};

/** Builds a fresh filter instance for the given shader id, or undefined if
 * the id isn't a known effect (missing sprite/effect -> graceful fallback,
 * same rule as SPRITE_OVERRIDES lookups). Each caller gets its own instance
 * since Filter carries per-use GPU state. */
export function createShaderEffect(
  id: string,
  params?: Record<string, number | string | boolean>,
): ShaderEffect | undefined {
  return REGISTRY[id]?.(params);
}
