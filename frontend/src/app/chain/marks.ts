import { ChainProfile } from '@app/chain/chain-module';

/** The mark of a sidechain without a profile: a block (app-svg-images chain-mark, fill 'sidechain') */
export const SIDECHAIN_MARK: Pick<ChainProfile, 'mark' | 'markRects'> = {
  mark: [], markRects: [{ x: 7, y: 7, w: 18, h: 18, rx: 4.5 }],
};

/**
 * Marks of the sidechains the enforcer declares, built in the same 32x32 stroke style as the eCash mark (no logo
 * files: these are icons, so they take the slot's colour and stay sharp at any size). Keyed by the sidechain title,
 * lowercased and stripped of everything but letters and digits.
 */
export const SIDECHAIN_MARKS: Record<string, Pick<ChainProfile, 'mark' | 'markRects'>> = {
  bitnames: { mark: [
    'M9 5h15a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H9a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z',
    'M9 5v22', 'M13 12h8', 'M13 17h6',
  ] },
  bitassets: { mark: [
    'M6 9c0-2.2 4.5-4 10-4s10 1.8 10 4-4.5 4-10 4S6 11.2 6 9z',
    'M6 9v14c0 2.2 4.5 4 10 4s10-1.8 10-4V9',
    'M6 16c0 2.2 4.5 4 10 4s10-1.8 10-4',
  ] },
  solana: { mark: [
    'M7 10.5l3-3h16l-3 3z', 'M6 17.5l3-3h16l-3 3z', 'M9 24.5l3-3h16l-3 3z',
  ] },
  thunder: { mark: ['M18.5 3.5 9 18h6.5L13.5 28.5 23 14h-6.5z'] },
  truthcoin: { mark: [
    'M28 16a12 12 0 1 1-24 0 12 12 0 1 1 24 0', 'M10.5 16.5l3.5 3.5 7-7.5',
  ] },
  elements: { mark: ['M16 4c4 5 8 8.5 8 13a8 8 0 0 1-16 0c0-4.5 4-8 8-13z', 'M12.5 18a4.5 4.5 0 0 0 3.5 4'] },
  zside: { mark: [
    'M16 4l10 4v7c0 6-4 10.5-10 13-6-2.5-10-7-10-13V8z',
    'M16 12a3 3 0 0 0-1 5.8V21h2v-3.2A3 3 0 0 0 16 12z',
  ] },
  photon: { mark: [
    'M16 11a5 5 0 1 0 0 10 5 5 0 1 0 0-10',
    'M16 3v4M16 25v4M3 16h4M25 16h4M7 7l2.5 2.5M22.5 22.5L25 25M25 7l-2.5 2.5M9.5 22.5L7 25',
  ] },
  // FreeBank: a bank (🏦), a pediment over four columns on a stepped base
  freebank: { mark: ['M16 4 27 10H5z', 'M9 13.5v9', 'M14 13.5v9', 'M18 13.5v9', 'M23 13.5v9', 'M6 25.5h20', 'M4 28.5h24'] },
  // Flush: water, three waves (a placeholder until Flush has a mark of its own)
  // Flush's own mark, the "tornado" (backbone-flush src/webui/app/src/chain/chain.json brand.mark;
  // ~/skydoge/media/flush/mark/variants.json)
  flush: { mark: ['M4 6h24', 'M8 12.5h17', 'M12 19h10', 'M15 25.5h4'] },
  coinshift: { mark: [
    'M7 16a9 9 0 0 1 15-6.7', 'M22 5v5h-5',
    'M25 16a9 9 0 0 1-15 6.7', 'M10 27v-5h5',
  ] },
};

/**
 * The official eCash mark (ecash.com/ecash-logo.svg, the paths as published; brand gold #E6A849), as filled paths in its
 * own coordinates: ECASH_MARK_VIEWBOX frames the mark's bounds (x 172.9-627.1, y 168.0-632.0). Drawn wherever eCash's mark
 * appears (app-svg-images chain-mark with fill 'ecash', the header logo, the favicon); a sidechain explorer's logo shows
 * it to the left of the sidechain's own mark.
 */
export const ECASH_MARK_PATHS: string[] = [
  'M406.486,280.925 C472.249,280.925 525.561,334.237 525.561,400 C525.358,408.043 525.507,408.242 524.189,418.134 C523.947,419.947 523.456,421.719 523.09,423.511 C523.09,423.511 405.336,423.511 386.482,423.511 C370.04,423.511 370.04,384.532 386.482,384.483 C402.054,384.436 472.372,384.483 472.372,384.483 C466.039,353.583 436.989,333.042 406.486,332.27 C369.08,332.27 338.756,362.594 338.756,400 C338.756,437.406 369.08,467.73 406.486,467.73 L503.953,468.213 C482.286,500.711 444.793,518.106 406.486,519.075 C340.723,519.075 287.411,465.764 287.411,400 C287.645,390.728 287.36,395.905 288.518,384.483 C288.518,384.483 179.855,384.448 173.697,384.483 C173.487,383.519 176.227,361.201 177.054,359.229 C180.355,359.237 294.583,359.229 294.583,359.229 C313.423,311.336 355.039,282.226 406.486,280.925 L406.486,280.925 z',
  'M405.602,168.039 C500.166,168.102 591.592,230.091 623.305,319.984 L557.167,319.984 C527.101,263.666 470.365,231.736 407.27,229.753 C343.525,230.368 289.192,265.152 257.645,319.744 L187.883,319.744 C220.501,227.325 309.303,171.991 405.602,168.039 L405.602,168.039 z',
  'M234.989,423.511 C247.224,508.566 319.245,569.437 404.565,570.513 C471.073,570.482 535.175,530.189 561.39,468.467 L627.11,468.467 C597.06,566.545 506.089,630.683 404.565,631.961 C285.944,631.636 184.961,541.936 172.889,423.511 L234.989,423.511 z',
];
export const ECASH_MARK_VIEWBOX = '170 166 460 468';
export const ECASH_GOLD = '#E6A849';
