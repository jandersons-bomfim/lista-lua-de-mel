/** Resolve imagens da lista: URLs completas ficam como estão; caminhos locais ("img/x.jpg" ou "/img/x.jpg")
 *  são resolvidos a partir da pasta onde o site está publicado (funciona em GitHub Pages, em subpasta). */
export function resolveAsset(src: string | null | undefined, base: string = import.meta.env.BASE_URL): string | null {
  if (!src) return null;
  if (/^(https?:|data:)/i.test(src)) return src;
  return base.replace(/\/?$/, '/') + src.replace(/^\/+/, '');
}
