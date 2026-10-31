import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * De dónde lee un adaptador: un fichero local o una URL. Separar esto del parseo permite
 * pasar del fixture al feed real cambiando solo la configuración.
 */
export interface TextSource {
  readonly location: string;
  read(): Promise<string>;
  /** Resuelve una ruta relativa del feed (p. ej. una imagen) respecto al propio feed. */
  resolve(ref: string): string;
}

export class FileSource implements TextSource {
  constructor(readonly location: string) {}

  read(): Promise<string> {
    return readFile(this.location, 'utf8');
  }

  resolve(ref: string): string {
    if (/^https?:\/\//i.test(ref) || isAbsolute(ref)) return ref;
    return resolve(dirname(this.location), ref);
  }
}

export class HttpSource implements TextSource {
  constructor(
    readonly location: string,
    private readonly init: RequestInit = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async read(): Promise<string> {
    const res = await this.fetchImpl(this.location, {
      ...this.init,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`No se pudo descargar ${this.location}: HTTP ${res.status}`);
    return res.text();
  }

  resolve(ref: string): string {
    return new URL(ref, this.location).toString();
  }
}

export function sourceFor(location: string): TextSource {
  return /^https?:\/\//i.test(location) ? new HttpSource(location) : new FileSource(location);
}
