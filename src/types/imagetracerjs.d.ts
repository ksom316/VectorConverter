declare module "imagetracerjs" {
  interface ImageTracerOptions {
    [key: string]: unknown;
  }

  interface SimpleImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  const ImageTracer: {
    checkoptions(options: Partial<ImageTracerOptions>): ImageTracerOptions;
    imagedataToTracedata(imgd: SimpleImageData, options: ImageTracerOptions): unknown;
    getsvgstring(tracedata: unknown, options: ImageTracerOptions): string;
  };

  export default ImageTracer;
}
