import axios from 'axios';
import enforcer from '../../chain/enforcer';
import { coinbaseTags, coinbaseText, difficultyOf, destinationText, subsidyAt } from '../../chain/drivechain';
import { escrowSlot, parseBip300Script } from '../../chain/bip300';

// Replies recorded from the betanet bip300301_enforcer (17eb2ce) on 22 October 2026, at height 973,919. backboned
// gave byte-identical replies to the same requests.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FIXTURES: Record<string, any> = require('./enforcer-betanet.json');

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

beforeEach(() => {
  mockedPost.mockImplementation(async (url: string, body: any) => {
    const method = url.split('/').pop() as string;
    const arg = body?.sidechainNumber ?? body?.sidechainId;
    const reply = FIXTURES[arg === undefined ? method : `${method}:${arg}`];
    return reply ? { status: 200, data: reply } : { status: 400, data: { code: 'invalid_argument', message: 'no fixture' } };
  });
});

describe('enforcer client', () => {
  it('reads the chain tip', async () => {
    const tip = await enforcer.getChainTip();
    expect(tip).toEqual({
      hash: '000000000000000032228e575a74a717051f39b27c1a03784e0f61ca625998ae',
      prevHash: '0000000000000000433cee33ef01c70517db717fbad5eed9cf05a709556e9017',
      height: 973919,
      time: 1792668688,
    });
  });

  it('reads the BIP300 constants, betanet reporting itself as mainnet', async () => {
    const info = await enforcer.getChainInfo();
    expect(info.network).toBe('NETWORK_MAINNET');
    expect(info.activationHeight).toBe(967680);
    expect(info.bundleThreshold).toBe(13150);
    expect(info.bundleMaxAge).toBe(26300);
  });

  it('reads the sidechains with their declarations', async () => {
    const [bitnames, thunder] = await enforcer.getSidechains();
    expect(bitnames).toMatchObject({ slot: 2, title: 'BitNames', activationHeight: 968998, proposalHeight: 967989 });
    expect(thunder).toMatchObject({ slot: 9, title: 'Thunder' });
  });

  it('fills in the fields proto3 JSON leaves out', async () => {
    // slot 24's escrow has never been spent: no sequence number in the reply
    expect(await enforcer.getCtip(24)).toEqual({ txid: '9d0f1ecd310f7d90f357af832bef667af69908319ad5f84195c01bae98a35536', vout: 0, amount: 100000, sequence: 0 });
    // slot 99 has no escrow at all
    expect(await enforcer.getCtip(99)).toBeNull();
  });

  it('reverses M6 ids into display order', async () => {
    const [p] = await enforcer.getBundleProposals(9);
    expect(p.m6id).toBe(Buffer.from('aa769fec72ddc7e59fb6dc480d62ba19236804598d053b6c50522cae30b0ced4', 'hex').reverse().toString('hex'));
    expect(p).toMatchObject({ voteCount: 661, proposalHeight: 970438 });
    expect(await enforcer.getBundleProposals(2)).toEqual([]);
  });

  it('reads deposits and BMM commitments from the peg data', async () => {
    const [withDeposit, bmmOnly] = await enforcer.getPegData(2, null, 'unused');
    expect(withDeposit.header.height).toBe(973892);
    expect(withDeposit.deposits).toEqual([{
      sequence: 12, txid: 'cb033cd614af6356d6c0dc0910ba42f7d85d96aa75897dbccbf774641c0e72e2', vout: 0,
      address: '6263317134397a716c3963706c7875376e6e6675793771336d706672353236353675307035367a733438', amount: 90000,
    }]);
    expect(withDeposit.bmmCommitment).toBe(Buffer.from('0345d02d2f1f7083918c8eebee0e2162343643bc198acb87a0917107df4c1d3b', 'hex').reverse().toString('hex'));
    expect(bmmOnly.deposits).toEqual([]);
    expect(destinationText(withDeposit.deposits[0].address)).toBe('bc1q49zql9cplxu7nnfuy7q3mpfr52656u0p56zs48');
  });

  it('reports the enforcer\'s error', async () => {
    await expect(enforcer.getBundleProposals(77)).rejects.toThrow('GetWithdrawalBundleProposals: invalid_argument: no fixture');
  });
});

describe('eCash rules', () => {
  it('computes the difficulty of a compact target', () => {
    expect(difficultyOf(0x1d00ffff)).toBe(1);
    expect(difficultyOf(0x1b0404cb)).toBeCloseTo(16307.42, 1);
  });

  it('follows Bitcoin\'s subsidy schedule', () => {
    expect(subsidyAt(0)).toBe(50e8);
    expect(subsidyAt(973919)).toBe(3.125e8);
  });

  it('reads escrow outputs written with OP_NOP8, not OP_NOP5', () => {
    expect(escrowSlot('b7010951')).toBe(9);
    expect(escrowSlot('b4010951')).toBeNull();
  });

  it('decodes an M8 BMM request', () => {
    const side = '11'.repeat(32);
    const prev = '22'.repeat(32);
    const m = parseBip300Script('6a44' + '00bf0009' + side + prev);
    expect(m).toMatchObject({ kind: 'M8', slot: 9, hash: side, prevMainBlock: prev });
  });

  it('reads DATUM tags only from a text push', () => {
    // OCEAN's: "< OCEAN.XYZ >" 0x0f "NiceHash", zeros after
    const ocean = '0399da0e173c204f4345414e2e58595a203e0f4e696365486173680007209210431e965c0e3088b10cf00db882d2238dccb401';
    expect(coinbaseTags(ocean)).toEqual({ datum: true, pool: 'OCEAN.XYZ', miner: 'NiceHash' });
    // Foundry's extranonce push holds a 0x0f byte; F2Pool's merge-mining commitment does too
    expect(coinbaseTags('038dda0e04c821ff0f2f466f756e6472792055534120506f6f6c202364726f70676f6c642f7bb321e6ab07000000000000').datum).toBe(false);
    expect(coinbaseTags('0396da0e2cfabe6d6d29e73e6ea789361b0f7966f2c1b728ea37bb3918502c80de612ee936ccb45a3510000000f09f909f092f4632506f6f6c2f620000000000000000000000').datum).toBe(false);
  });

  it('keeps HTML out of coinbase tags and text', () => {
    const tag = Buffer.from('<img src=x onerror=alert(1)>Pool').toString('hex');
    const script = '03' + 'aaaaaa' + (tag.length / 2).toString(16).padStart(2, '0') + tag;
    expect(coinbaseTags(script).pool).toBe('img src=x onerror=alert(1)Pool');
    expect(coinbaseText(script).join(' ')).not.toMatch(/[<>]/);
  });
});
