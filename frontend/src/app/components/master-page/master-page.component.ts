import { Component, OnInit, OnDestroy, Input, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Env, StateService } from '@app/services/state.service';
import { Observable, combineLatest, map, merge, of, startWith, Subscription } from 'rxjs';
import { LanguageService } from '@app/services/language.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { NavigationService } from '@app/services/navigation.service';
import { MenuComponent } from '@components/menu/menu.component';
import { StorageService } from '@app/services/storage.service';
import { AuthServiceMempool } from '@app/services/auth.service';

import { CHAIN_NETWORK, MODULE, NETWORK_NAME, PROFILE, NavItem } from '@app/chain/profiles';
import { ChainApiService } from '@app/chain/chain-api.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { L2_NAV, l2FeatureNav } from '@app/chain/l2/l2-nav';
@Component({
  selector: 'app-master-page',
  templateUrl: './master-page.component.html',
  styleUrls: ['./master-page.component.scss'],
  standalone: false,
})
export class MasterPageComponent implements OnInit, OnDestroy {
  // eCash Explorer: this explorer's chain and network, its pages, and the other networks' explorers (those with a URL)
  profile = PROFILE;
  chainNetwork = CHAIN_NETWORK;
  networkName = NETWORK_NAME;
  chainNav: NavItem[] = [
    { path: '/drivechain', title: 'Drivechain: sidechains, BMM, deposits, withdrawals, votes', icon: 'nav-drivechain' },
    ...(MODULE.nav ?? []),
  ];
  /** the nav entries of this chain's pages: the eCash explorer's above; a sidechain's (deposits and withdrawals, BMM,
   * the feature pages its backend serves) from GET /api/v1/chain */
  chainNav$: Observable<NavItem[]>;
  networks$: Observable<{ others: { id: string; name: string; explorer: string | null }[] }>;
  @Input() headerVisible = true;
  @Input() footerVisibleOverride: boolean | null = null;

  env: Env;
  network$: Observable<string>;
  connectionState$: Observable<number>;
  navCollapsed = false;
  isMobile = window.innerWidth <= 767.98;
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;
  officialMempoolSpaceBuild = this.stateService.isMempoolSpaceBuild;
  urlLanguage: string;
  subdomain = '';
  networkPaths: { [network: string]: string };
  networkPaths$: Observable<Record<string, string>>;
  footerVisible = true;
  user: any = undefined;
  servicesEnabled = false;
  menuOpen = false;
  isDropdownVisible: boolean;

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;
  authSubscription$: Subscription;

  @ViewChild(MenuComponent)
  public menuComponent!: MenuComponent;

  constructor(
    public stateService: StateService,
    private languageService: LanguageService,
    private enterpriseService: EnterpriseService,
    private navigationService: NavigationService,
    private storageService: StorageService,
    private authService: AuthServiceMempool,
    private router: Router,
    private chainApi: ChainApiService,
    private l2Api: L2ApiService,
  ) { }

  ngOnInit(): void {
    this.chainNav$ = PROFILE.kind !== 'l2' ? of(this.chainNav) : combineLatest([
      this.l2Api.features$, this.chainApi.chain$().pipe(startWith(null)),
    ]).pipe(
      // upstream's own Blocks entry stays; the BMM page only where the backend reads the eCash drivechain index
      map(([f, c]) => [...L2_NAV.filter(n => n.path !== '/blocks' && (n.path !== '/bmm' || c?.bmm !== false)), ...l2FeatureNav(f, true)]),
    );
    this.networks$ = this.chainApi.chain$().pipe(
      map(c => ({ others: (c?.networks ?? []).filter(n => n.id !== (c?.network ?? CHAIN_NETWORK) && !!n.explorer) })),
    );
    this.env = this.stateService.env;
    this.connectionState$ = this.stateService.connectionState$;
    this.network$ = merge(of(''), this.stateService.networkChanged$);
    this.urlLanguage = this.languageService.getLanguageForUrl();
    this.subdomain = this.enterpriseService.getSubdomain();
    this.navigationService.subnetPaths.subscribe((paths) => {
      this.networkPaths = paths;
      if (this.footerVisibleOverride === null) {
        if (paths.mainnet.indexOf('docs') > -1) {
          this.footerVisible = false;
        } else {
          this.footerVisible = true;
        }
      } else {
        this.footerVisible = this.footerVisibleOverride;
      }
    });
    this.enterpriseInfo$ = this.enterpriseService.info$.subscribe(info => {
      this.enterpriseInfo = info;
    });

    this.servicesEnabled = this.officialMempoolSpace && this.stateService.env.ACCELERATOR === true && this.stateService.network === '';
    this.authSubscription$ = this.authService.getAuth$().subscribe((auth) => {
      this.user = auth?.user ?? null;
    });

    const isServicesPage = this.router.url.includes('/services/');
    this.menuOpen = isServicesPage && !this.isSmallScreen();
    this.setDropdownVisibility();
  }

  get networkDisplayName(): string {
    return this.stateService.networkDisplayName;
  }

  setDropdownVisibility(): void {
    const networks = [
      this.env.TESTNET_ENABLED,
      this.env.TESTNET4_ENABLED,
      this.env.SIGNET_ENABLED,
      this.env.REGTEST_ENABLED,
      this.env.LIQUID_ENABLED,
      this.env.LIQUID_TESTNET_ENABLED,
      this.env.MAINNET_ENABLED,
    ];
    const enabledNetworksCount = networks.filter((networkEnabled) => networkEnabled).length;
    this.isDropdownVisible = enabledNetworksCount > 1;
  }

  collapse(): void {
    this.navCollapsed = !this.navCollapsed;
  }

  isSmallScreen(): boolean {
    return window.innerWidth <= 767.98;
  }

  onResize(): void {
    this.isMobile = this.isSmallScreen();
  }

  brandClick(e): void {
    this.stateService.resetScroll$.next(true);
  }

  onLoggedOut(): void {
    this.refreshAuth();
  }

  refreshAuth(): void {
    this.user = this.storageService.getAuth()?.user ?? null;
  }

  hamburgerClick(event): void {
    if (this.menuComponent) {
      this.menuComponent.hamburgerClick();
      this.menuOpen = this.menuComponent.navOpen;
      event.stopPropagation();
    }
  }

  menuToggled(isOpen: boolean): void {
    this.menuOpen = isOpen;
  }

  ngOnDestroy(): void {
    if (this.enterpriseInfo$) {
      this.enterpriseInfo$.unsubscribe();
    }
    if (this.authSubscription$) {
      this.authSubscription$.unsubscribe();
    }
  }

}
