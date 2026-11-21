declare module "gifenc" {
  export interface GifEncoder {
    writeFrame(
      indexed: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: number[][];
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
        dispose?: number;
      },
    ): void;
    finish(): void;
    bytesView(): Uint8Array;
  }
  export function GIFEncoder(): GifEncoder;
}
