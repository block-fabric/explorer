import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { ChainInfo } from '@app/chain/chain.interfaces';
import { MODULE, NETWORK_NAME, PROFILE } from '@app/chain/profiles';
import { SeoService } from '@app/services/seo.service';
import { l2FeatureNav } from '@app/chain/l2/l2-nav';

/** /about: what this explorer shows, where its data comes from, the other eCash networks, and where its code comes from */
@Component({
  selector: 'app-chain-about',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  styleUrls: ['../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .lead { font-size: 1.05rem; max-width: 820px; }
    p, ul { max-width: 820px; }
    .nets { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .net { display: block; padding: 12px 14px; border-radius: 8px; background: var(--box-bg); color: var(--fg); text-decoration: none;
      border: 1px solid color-mix(in srgb, var(--chain-accent, #E6A849) 35%, transparent); }
    a.net:hover { border-color: var(--chain-accent, #E6A849); text-decoration: none; }
    .net.here { border-color: var(--chain-accent, #E6A849); }
    .net b { display: block; } .net small { color: var(--transparent-fg); }
  `],
  template: `
  <div class="container-xl mp">
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images> About the {{ profile.name }} Explorer</h1>
    <p class="lead">{{ profile.tagline }} · {{ networkName }}.</p>

    <ng-container *ngIf="l2">
      <p>{{ profile.name }} is a drivechain sidechain of eCash (BIP300 slot {{ profile.slot }}): ECX moves onto it by a deposit into its
        escrow on eCash, and back by a withdrawal that eCash miners vote on in a bundle before it is paid. Its blocks are made by blind
        merged mining (BIP301): an eCash miner commits to each one and is paid the bid of its BMM request. Amounts are in sats
        (1 ECX = 100,000,000 sats); there is no proof of work, no mining pools and no price on the sidechain.</p>
      <p>Besides blocks, transactions, addresses and the mempool, this explorer shows for each block the eCash block that carried it and the
        bid paid for it, the deposits from eCash and the withdrawals to eCash, the
        <a [routerLink]="['/bmm']">blind merged mining of the chain on eCash</a><ng-container *ngIf="nav.length">, and
        <ng-container *ngFor="let n of nav; let last = last"><a [routerLink]="[n.path]">{{ n.title.toLowerCase() }}</a>{{ last ? '' : ', ' }}</ng-container></ng-container>.</p>
      <h2>Where the data comes from</h2>
      <p>The explorer reads the chain from a {{ profile.name }} node, indexes it, and reads the eCash side (deposits, withdrawal bundles,
        BMM requests and accepts) from the eCash explorer of the same network.</p>
    </ng-container>
    <ng-container *ngIf="flush">
      <p>{{ profile.name }} is a sidechain of eCash (BIP300 slot {{ profile.slot }}) built on Bitcoin Core: blocks of stake every slot, signed by
        the slot's leader among the bonded validators, and anchored to eCash by blind merged mining (BIP301), so that blocks become anchored,
        then final. On it: assets with tickers and logos, a DEX (pools of several kinds, concentrated liquidity, order books, all orders of
        a block cleared together), bonding-curve launches that graduate into a locked pool, a treasury, oracles and verified issuers.
        ECX moves onto it by a deposit into its escrow on eCash, and back in withdrawal bundles that eCash miners vote on.</p>
      <p>Besides blocks, transactions, addresses and the mempool (with each block's kind, slot, signer and finality, and what each
        transaction does with assets, the peg and stake), this explorer shows
        <ng-container *ngFor="let n of nav; let last = last"><a [routerLink]="[n.path]">{{ n.title.toLowerCase() }}</a>{{ last ? '' : ', ' }}</ng-container>.</p>
      <h2>Where the data comes from</h2>
      <p>The explorer reads the chain from a {{ profile.name }} node over RPC (its read-only methods), the markets' trades, candles and
        holders from the node's public DEX API, and the eCash side of the peg and BMM from the eCash explorer of the same network.</p>
    </ng-container>
    <ng-container *ngIf="freebank">
      <p>{{ profile.name }} is a drivechain sidechain of eCash (BIP300 slot {{ profile.slot }}) built on Bitcoin Core 0.16: its blocks have no
        proof of work, an eCash miner commits to each one by blind merged mining (BIP301). On it: discount houses that mint notes against
        the escrow their partners pledge and the reserves they attest, bills of exchange that houses discount into their loan books, term
        deposits, settlements between houses, note pools and a gold-price oracle. ECX moves onto it by a deposit into its escrow on eCash,
        and back in withdrawal bundles that eCash miners vote on.</p>
      <p>Besides blocks, transactions and the mempool (with the eCash block each block was mined in, and what each transaction does in
        credit), this explorer shows
        <ng-container *ngFor="let n of nav; let last = last"><a [routerLink]="[n.path]">{{ n.title.toLowerCase() }}</a>{{ last ? '' : ', ' }}</ng-container>.
        It keeps no address index: an address's balance and history are not shown.</p>
      <h2>Where the data comes from</h2>
      <p>The explorer reads the chain from a {{ profile.name }} node over RPC (its read-only methods, on an allowlist), and the eCash side of
        the peg and BMM from the eCash explorer of the same network.</p>
    </ng-container>
    <ng-container *ngIf="!l2 && !flush && !freebank">
    <p>eCash ({{ profile.unit }}) is a fork of Bitcoin with Bitcoin's own formats: the same addresses, 8-decimal amounts, 10-minute blocks,
      difficulty retargets every 2016 blocks and halvings every 210,000 blocks. It adds drivechains (BIP300 and BIP301): sidechains that
      lock {{ profile.unit }} in an escrow on eCash, have their blocks committed by eCash miners through blind merged mining, and send coins
      back through withdrawal bundles that miners vote on before they can be paid.</p>
    <p>Besides blocks, transactions and the mempool, this explorer shows everything the drivechain does: which sidechain blocks each
      eCash block committed to and the bids paid for them, deposits and withdrawals, the votes on every bundle, sidechain proposals,
      and in the <a [routerLink]="['/drivechain' | relativeUrl]">Drivechain cockpit</a> statistics over all of it<ng-container *ngIf="nav.length">;
      see also <ng-container *ngFor="let n of nav; let last = last"><a [routerLink]="[n.path | relativeUrl]">{{ n.title.toLowerCase() }}</a>{{ last ? '' : ', ' }}</ng-container></ng-container>.</p>

    <h2>Where the data comes from</h2>
    <p>The explorer reads the chain from an eCash node over RPC, and the drivechain state (active sidechains, escrows, deposits,
      withdrawal bundles and their votes, BMM commitments) from a BIP300/301 enforcer's validator service. Either of these setups serves it:</p>
    <ul>
      <li>a stock eCash node with <b>bip300301_enforcer</b> next to it;</li>
      <li><b>Backbone</b> (backboned), which enforces BIP300/301 itself and serves the same validator service.</li>
    </ul>
    </ng-container>

    <ng-container *ngIf="chain$ | async as c">
      <h2>eCash networks</h2>
      <div class="nets">
        <ng-container *ngFor="let n of c.networks">
          <a *ngIf="n.id !== c.network && n.explorer; else plain" class="net" [href]="n.explorer">
            <b>{{ n.name }}</b><small>{{ n.id }}</small>
          </a>
          <ng-template #plain>
            <div class="net" [class.here]="n.id === c.network" *ngIf="n.id === c.network || n.explorer">
              <b>{{ n.name }}{{ n.id === c.network ? ' (this explorer)' : '' }}</b><small>{{ n.id }}</small>
            </div>
          </ng-template>
        </ng-container>
      </div>
    </ng-container>

    <h2>Software</h2>
    <p>This explorer is a modified version of the <a href="https://github.com/mempool/mempool" target="_blank" rel="noopener">mempool</a>
      open-source explorer, used under the GNU Affero General Public License v3.0; its modifications are under the same license.
      "mempool" is a trademark of Mempool Space K.K.; this explorer is not affiliated with it.</p>
    <p><a href="3rdpartylicenses.txt">Third-party licenses</a></p>
  </div>`,
})
export class ChainAboutPage implements OnInit {
  profile = PROFILE;
  networkName = NETWORK_NAME;
  l2 = PROFILE.kind === 'l2';
  flush = PROFILE.kind === 'flush';
  freebank = PROFILE.kind === 'freebank';
  nav = PROFILE.kind === 'l2' ? l2FeatureNav((MODULE.features ?? []) as string[]) : (MODULE.nav ?? []);
  chain$: Observable<ChainInfo | null>;

  constructor(private seo: SeoService, private api: ChainApiService) {}

  ngOnInit(): void {
    this.seo.setTitle(`About the ${PROFILE.name} Explorer`);
    this.chain$ = this.api.chain$();
  }
}
