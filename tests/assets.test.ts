import { describe, expect, it } from 'vitest';
import { resolveAsset } from '../src/lib/assets';

describe('imagens em subpasta (GitHub Pages)', () => {
  it('resolve caminhos locais a partir da base do site', () => {
    expect(resolveAsset('/img/cristo.jpg', './')).toBe('./img/cristo.jpg');
    expect(resolveAsset('img/cristo.jpg', './')).toBe('./img/cristo.jpg');
    expect(resolveAsset('img/cristo.jpg', '/lista-lua-de-mel/')).toBe('/lista-lua-de-mel/img/cristo.jpg');
  });
  it('mantém URLs completas e trata vazio', () => {
    expect(resolveAsset('https://exemplo.com/a.jpg', './')).toBe('https://exemplo.com/a.jpg');
    expect(resolveAsset(null, './')).toBeNull();
  });
});
