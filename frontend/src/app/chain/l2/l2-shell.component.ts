import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Observable, Subscription, map } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { StateService } from '@app/services/state.service';
import { StorageService } from '@app/services/storage.service';
import { CHAIN_NETWORK, NETWORK_NAME, NavItem, PROFILE } from '@app/chain/profiles';
import { ChainApiService } from '@app/chain/chain-api.service';
import { ChainSwitcherComponent } from '@app/chain/components/chain-switcher/chain-switcher.component';
import { L2_AMOUNT_MODE_KEY } from '@components/amount-selector/amount-selector.component';
import { L2ApiService, l2Error } from '@app/chain/l2/l2-api.service';
import { L2_NAV, l2FeatureNav } from '@app/chain/l2/l2-nav';

/**
 * The site shell of a sidechain explorer (PROFILE.kind 'l2'), in place of upstream's MasterPageComponent: the header
 * (logo and name, network badge and switcher, chain switcher, the pages, search) and the footer, around the L2 pages.
 * It uses only /api/v1/chain and /api/v1/l2/*: no websocket, no upstream API.
 */
@Component({
  selector: 'app-l2-shell',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SharedModule, ChainSwitcherComponent],
  templateUrl: './l2-shell.component.html',
  // the header's look is the eCash explorer's (master-page), plus the search box
  styleUrls: ['../../components/master-page/master-page.component.scss', './l2-shell.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class L2ShellComponent implements OnInit, OnDestroy {
  profile = PROFILE;
  chainNetwork = CHAIN_NETWORK;
  networkName = NETWORK_NAME;
  nav$: Observable<NavItem[]>;
  networks$: Observable<{ others: { id: string; name: string; explorer: string | null }[] }>;
  query = '';
  searching = false;
  searchError: string | null = null;
  private sub: Subscription | null = null;

  constructor(
    private api: L2ApiService,
    private chainApi: ChainApiService,
    private router: Router,
    private cd: ChangeDetectorRef,
    stateService: StateService,
    storageService: StorageService,
  ) {
    // amounts in sats unless the viewer chose ECX (the footer's selector)
    const mode = storageService.getValue(L2_AMOUNT_MODE_KEY) === 'btc' ? 'btc' : 'sats';
    stateService.viewAmountMode$.next(mode);
  }

  ngOnInit(): void {
    this.nav$ = this.api.features$.pipe(map(f => [...L2_NAV, ...l2FeatureNav(f, true)]));
    this.networks$ = this.chainApi.chain$().pipe(
      map(c => ({ others: (c?.networks ?? []).filter(n => n.id !== (c?.network ?? CHAIN_NETWORK) && !!n.explorer) })),
    );
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** a height, block hash, txid or address: GET /api/v1/l2/search/:query, then its page */
  search(): void {
    const q = this.query.trim();
    if (!q || this.searching) {
      return;
    }
    this.searching = true;
    this.searchError = null;
    this.sub?.unsubscribe();
    this.sub = this.api.search$(q).subscribe({
      next: (r) => {
        this.searching = false;
        if (r?.type && r.id) {
          this.query = '';
          void this.router.navigate(['/' + r.type, r.id]);
        } else {
          this.searchError = 'Nothing found on ' + PROFILE.name + ' for this height, hash, txid or address';
        }
        this.cd.markForCheck();
      },
      error: (e) => {
        this.searching = false;
        const err = l2Error(e);
        this.searchError = err.status === 404 || err.status === 400
          ? 'Nothing found on ' + PROFILE.name + ' for this height, hash, txid or address' : err.message;
        this.cd.markForCheck();
      },
    });
  }

  clearError(): void {
    if (this.searchError) {
      this.searchError = null;
    }
  }
}
