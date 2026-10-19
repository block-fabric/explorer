import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';
import { MODULE, PROFILE, PROFILES, SIDECHAINS, explorerUrl } from '@app/chain/profiles';
import { SeoService } from '@app/services/seo.service';

/** /about: what this explorer shows, the Chains network it belongs to, and where its code comes from */
@Component({
  selector: 'app-chain-about',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  styleUrls: ['../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .lead { font-size: 1.05rem; max-width: 820px; }
    p { max-width: 820px; }
    .chains { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
    .chain { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 8px; background: var(--box-bg);
      border: 1px solid color-mix(in srgb, var(--c) 35%, transparent); text-decoration: none; color: var(--fg); }
    a.chain:hover { border-color: var(--c); text-decoration: none; }
    .chain.here { border-color: var(--c); }
    .chain app-svg-images { color: var(--c); display: inline-flex; margin-top: 2px; }
    .chain b { display: block; } .chain small { color: var(--transparent-fg); }
  `],
  template: `
  <div class="container-xl mp">
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images> About the {{ profile.name }} Explorer</h1>
    <p class="lead">{{ profile.tagline }}.</p>

    <ng-container *ngIf="profile.mainchain">
      <p>Chains (CHN) is a proof-of-work coin with drivechains (BIP300 and BIP301): sidechains that lock CHN in an escrow on the mainchain,
        have their blocks committed by Chains miners through blind merged mining, and send coins back through withdrawal bundles that
        miners vote on for weeks before they are paid.</p>
      <p>Besides blocks, transactions and the mempool, this explorer shows everything the drivechain does: which sidechain blocks each
        Chains block committed to and the bids paid for them, deposits and withdrawals, the votes on every bundle, sidechain proposals,
        and in the <a [routerLink]="['/drivechain' | relativeUrl]">Drivechain cockpit</a> statistics over all of it.</p>
    </ng-container>
    <ng-container *ngIf="!profile.mainchain">
      <p>{{ profile.name }} is a drivechain sidechain of Chains (CHN), in slot {{ profile.slot }}. Its coins are CHN, locked in its escrow on the
        mainchain when deposited and released by withdrawal bundles that Chains miners vote on.
        <ng-container *ngIf="profile.pos">Its blocks are made by bonded validators every 15 seconds; Chains blocks anchor them by blind merged
          mining, which makes them final, and make blocks themselves when no validator does.</ng-container>
        <ng-container *ngIf="!profile.pos">Its blocks are made by blind merged mining: a Chains miner commits to each one, for a bid.</ng-container></p>
      <p>Besides blocks, transactions and the mempool, this explorer shows the Chains block behind each block, its deposits and withdrawals
        (<a [routerLink]="['/bmm' | relativeUrl]">BMM and peg</a>)<ng-container *ngIf="nav.length">, and
        <ng-container *ngFor="let n of nav; let last = last"><a [routerLink]="[n.path | relativeUrl]">{{ n.title.toLowerCase() }}</a>{{ last ? '' : ', ' }}</ng-container></ng-container>.</p>
    </ng-container>

    <h2>The Chains network</h2>
    <div class="chains">
      <ng-container *ngFor="let c of chains">
        <a *ngIf="c.id !== profile.id && url(c.id) as u; else plain" class="chain" [href]="u" [style.--c]="c.color">
          <app-svg-images name="chain-mark" [fill]="c.id" width="22" height="22"></app-svg-images>
          <span><b>{{ c.name }}</b><small>{{ c.mainchain ? 'mainchain' : 'slot ' + c.slot }} · {{ c.tagline }}</small></span>
        </a>
        <ng-template #plain>
          <div class="chain" [class.here]="c.id === profile.id" [style.--c]="c.color">
            <app-svg-images name="chain-mark" [fill]="c.id" width="22" height="22"></app-svg-images>
            <span><b>{{ c.name }}{{ c.id === profile.id ? ' (this explorer)' : '' }}</b><small>{{ c.mainchain ? 'mainchain' : 'slot ' + c.slot }} · {{ c.tagline }}</small></span>
          </div>
        </ng-template>
      </ng-container>
    </div>

    <h2>Software</h2>
    <p>This explorer is a modified version of the <a href="https://github.com/mempool/mempool" target="_blank" rel="noopener">mempool</a>
      open-source explorer, used under the GNU Affero General Public License v3.0; its modifications are under the same license.
      It reads the chain from its own node over RPC. "mempool" is a trademark of Mempool Space K.K.; this explorer is not affiliated with it.</p>
    <p><a href="/3rdpartylicenses.txt">Third-party licenses</a></p>
  </div>`,
})
export class ChainAboutPage implements OnInit {
  profile = PROFILE;
  nav = MODULE.nav ?? [];
  chains = [PROFILES.chains, ...SIDECHAINS];
  url = (id: string) => explorerUrl(id);

  constructor(private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`About the ${PROFILE.name} Explorer`);
  }
}
