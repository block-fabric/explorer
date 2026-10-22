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
  freebank: { mark: ['M4 12 16 5l12 7', 'M6 12h20', 'M6 27h20', 'M9 14v9M14 14v9M18 14v9M23 14v9'] },
  coinshift: { mark: [
    'M7 16a9 9 0 0 1 15-6.7', 'M22 5v5h-5',
    'M25 16a9 9 0 0 1-15 6.7', 'M10 27v-5h5',
  ] },
};
