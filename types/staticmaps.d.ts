// Minimal ambient typings for the `staticmaps` package — only the surface
// our renderer uses. Upgrade to community types if they ever ship.

declare module "staticmaps" {
  type Coord = [number, number]; // [lng, lat]

  interface PolygonOpts {
    coords: Coord[];
    color?: string;
    width?: number;
    fill?: string;
  }
  interface CircleOpts {
    coord: Coord;
    radius: number; // metres
    color?: string;
    width?: number;
    fill?: string;
  }
  interface StaticMapsOpts {
    width: number;
    height: number;
    tileUrl?: string;
    tileSize?: number;
    paddingX?: number;
    paddingY?: number;
    tileSubdomains?: string[];
    tileRequestTimeout?: number;
    tileRequestHeader?: Record<string, string>;
    tileRequestLimit?: number;
    reverseY?: boolean;
    zoomRange?: { min?: number; max?: number };
    maxZoom?: number;
  }

  export default class StaticMaps {
    constructor(opts: StaticMapsOpts);
    addPolygon(opts: PolygonOpts): void;
    addCircle(opts: CircleOpts): void;
    addMarker(opts: { coord: Coord; img: string; width: number; height: number; offsetX?: number; offsetY?: number }): void;
    addLine(opts: { coords: Coord[]; color?: string; width?: number }): void;
    render(centerOrBbox?: Coord | [number, number, number, number], zoom?: number): Promise<void>;
    image: {
      buffer(mime: string, opts?: Record<string, unknown>): Promise<Buffer>;
      save(file: string, opts?: Record<string, unknown>): Promise<void>;
    };
  }
}
