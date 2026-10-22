import { describe, expect, it } from "vitest";
import { decodePng, encodePng, type PixelImage } from "./png";

/**
 * A picture that PowerPoint wrote: a palette image with a PLTE chunk, which is
 * the format the exporter's target application really uses. The expected
 * colours were read with an independent decoder, not with the one under test.
 */
const POWERPOINT_PALETTE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAMAAADSOgUjAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACBUExURf///5ynuoGPqHeGoR84ZFttjdzg50xgg/T19/f3+TlPdsfN2DRLcyY/aenr78LJ1Vhqiz1Tefv7/FptjaawwVZpiiI7ZouXrkFWezJJcSlBa3yKpERZfniHouvt8Wx8mZqmua+4yISRqb7G0sXM12d3lba/zau0xS1FbtHW3y51toyZSU0AAAAJcEhZcwAAA7AAAAOwASfED60AAAMRSURBVHhe7dfbcptAEIThRYCEIktIGDmy4zhHJ3He/wFTswsqV8eX45vh/67QyV09tcvilAAAAAAAAAAAAAAAAAAAAABgGapVSnVj2pTWmy7Vq5S2H3YpbW/y22Z/SCn17fVH22PXTx/Zt0/28evPl2S43aV6nPuvN91wHvu7nU2pzKVcbU+Hvi2D3h/yAFf5I5v/NLlFDnA4N00z1mOeT5pXlRnfGOD8omqau4+rvh3OY7Uqf+PSLXOAtujuD9cBllVlqjzA9UPTNHc7HaCtwNRfujSc25QvzFIH+Mm28DyfsknznS0PcNPZHn9rgH1rV8N5TPWjLcjyu2mWS1I1++sKTOVumMpS/H+AZYvbPfDGjpXrHq/yr5a5AvvPx6fjl3G9sSWVB5i355sDLBt8ezrUzaWb16qtuSUP8OvTsUv1WDXtPEAb2nWAr++BduC+ugem4dvpu+3YPMrlHiJlFufH0r62W9rq7RU4be95gMPtj9PP5/zWkldgGWB9+ZXPBBvD/rdNr5wR83fsan45DXD9x+ZahlaN6+clD3A4720SttzWD/kyPyDLfyJ1O72RH6Rf7g95lPkZxg6iBQ/w5cH+HbtpmpUdDilNNz5Zgev76VU+RPKs5i/Ys8xytzAAAAAAAAAAAAAAILC/70zzwtHC3jQvHC3sTfPC0cLeNC8cLexN88LRwt40Lxwt7E3zwtHC3jQvHC3sTfPC0cLeNC8cLexN88LRwt40Lxwt7E3zwtHC3jQvHC3sTfPC0cLeNC8cLexN88LRwt40Lxwt7E3zwtHC3jQvHC3sTfPC0cLeNC8cLexN88LRwt40Lxwt7E3zwtHC3jQvHC3sTfPC0cLeNC8cLexN88LRwt40Lxwt7E3zwtHC3jQvHC3sTfPC0cLeNC8cLexN88LRwt40Lxwt7E3zwtHC3jQvHC3sTfPC0cLeNC8cLexN88LRwt40Lxwt7E3zwtHC3jQvHC3sTfPC0cLeNC8cLexN88LRwt40DwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMD7+gd+GA/80+5CvwAAAABJRU5ErkJggg==";

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function solid(width: number, height: number, colour: [number, number, number, number]): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = colour[0];
    data[offset + 1] = colour[1];
    data[offset + 2] = colour[2];
    data[offset + 3] = colour[3];
  }
  return { width, height, data };
}

describe("PNG 编解码", () => {
  it("读出 PowerPoint 写的调色板图片的颜色", () => {
    const image = decodePng(fromBase64(POWERPOINT_PALETTE_PNG));
    expect(image.width).toBe(320);
    expect(image.height).toBe(180);
    const at = (x: number, y: number) => {
      const offset = (y * image.width + x) * 4;
      return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
    };
    expect(at(0, 0)).toEqual([255, 255, 255, 255]);
    expect(at(60, 90)).toEqual([0x2e, 0x75, 0xb6, 255]);
    expect(at(319, 179)).toEqual([255, 255, 255, 255]);
  });

  it("编码后再解码得到同样的像素", () => {
    const source = solid(5, 3, [0, 0, 0, 0]);
    const colours: [number, number, number, number][] = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [12, 34, 56, 200],
      [1, 2, 3, 4],
      [9, 9, 9, 9],
      [250, 251, 252, 253],
      [5, 6, 7, 8],
      [100, 200, 44, 255],
      [0, 0, 0, 0],
      [11, 22, 33, 44],
      [55, 66, 77, 88],
      [99, 111, 122, 133],
      [144, 155, 166, 177],
      [188, 199, 210, 221],
    ];
    colours.forEach((colour, index) => {
      const offset = index * 4;
      source.data[offset] = colour[0];
      source.data[offset + 1] = colour[1];
      source.data[offset + 2] = colour[2];
      source.data[offset + 3] = colour[3];
    });
    const decoded = decodePng(encodePng(source));
    expect(decoded.width).toBe(5);
    expect(decoded.height).toBe(3);
    expect(Array.from(decoded.data)).toEqual(Array.from(source.data));
  });

  it("拒绝不是 PNG 的输入", () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow("PNG_SIGNATURE_INVALID");
  });

  it("拒绝隔行的图片，而不是把它读错", () => {
    const bytes = fromBase64(POWERPOINT_PALETTE_PNG);
    bytes[28] = 1; // the interlace flag of IHDR
    expect(() => decodePng(bytes)).toThrow("PNG_INTERLACED_UNSUPPORTED");
  });

  it("编码空图时报错，不写出无法读回的文件", () => {
    expect(() => encodePng({ width: 0, height: 0, data: new Uint8ClampedArray(0) })).toThrow("PNG_SIZE_INVALID");
  });

  it("整幅同色的图片编码后仍然同色", () => {
    const image = solid(8, 8, [17, 34, 51, 255]);
    const decoded = decodePng(encodePng(image));
    expect(decoded.data[0]).toBe(17);
    expect(decoded.data[1]).toBe(34);
    expect(decoded.data[2]).toBe(51);
    expect(decoded.data[3]).toBe(255);
  });
});
