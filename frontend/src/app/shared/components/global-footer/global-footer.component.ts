import { Input, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, OnChanges, SimpleChanges, Inject, LOCALE_ID, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Observable, merge, of, Subject, Subscription } from 'rxjs';
import { map, tap, takeUntil } from 'rxjs/operators';
import { Env, StateService } from '@app/services/state.service';
import { IBackendInfo } from '@interfaces/websocket.interface';
import { LanguageService } from '@app/services/language.service';
import { NavigationService } from '@app/services/navigation.service';
import { StorageService } from '@app/services/storage.service';
import { WebsocketService } from '@app/services/websocket.service';
import { EnterpriseService } from '@app/services/enterprise.service';
import { SERVICES_POPUP_ACTION } from '@app/shared/services-popup-action.token';

import { CHAIN_NETWORK, MODULE, NETWORK_NAME, PROFILE } from '@app/chain/profiles';
import { ChainApiService } from '@app/chain/chain-api.service';
import { NavItem } from '@app/chain/chain-module';
import { ChainLink, chainLinks } from '@app/chain/chain-links';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { l2FeatureNav } from '@app/chain/l2/l2-nav';
@Component({
  selector: 'app-global-footer',
  templateUrl: './global-footer.component.html',
  styleUrls: ['./global-footer.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalFooterComponent implements OnInit, OnDestroy, OnChanges {
  @Input() user: any = undefined;

  private destroy$: Subject<any> = new Subject<any>();
  env: Env;
  officialMempoolSpace = this.stateService.env.OFFICIAL_MEMPOOL_SPACE;
  profile = PROFILE; // eCash Explorer
  networkName = NETWORK_NAME;
  moduleNav = MODULE.nav ?? [];
  /** a sidechain explorer (chain/l2/): its pages, and the other chains' explorers */
  l2 = PROFILE.kind === 'l2';
  l2Nav$: Observable<NavItem[]>;
  chainLinks$: Observable<ChainLink[]>;
  /** the other eCash networks' explorers (GET /api/v1/chain) */
  otherNetworks$: Observable<{ id: string; name: string; explorer: string | null }[]>;
  mempoolSpaceBuild = window['isMempoolSpaceBuild'];
  backendInfo$: Observable<IBackendInfo>;
  servicesBackendInfo$: Observable<IBackendInfo>;
  frontendGitCommitHash = this.stateService.env.GIT_COMMIT_HASH;
  packetJsonVersion = this.stateService.env.PACKAGE_JSON_VERSION;
  urlLanguage: string;
  network$: Observable<string>;
  networkPaths: { [network: string]: string };
  currentNetwork = '';
  urlSubscription: Subscription;
  isServicesPage = false;

  enterpriseInfo: any;
  enterpriseInfo$: Subscription;

  constructor(
    public stateService: StateService,
    private languageService: LanguageService,
    private navigationService: NavigationService,
    private enterpriseService: EnterpriseService,
    @Inject(LOCALE_ID) public locale: string,
    private storageService: StorageService,
    private route: ActivatedRoute,
    private cd: ChangeDetectorRef,
    private websocketService: WebsocketService,
    private router: Router,
    private chainApi: ChainApiService,
    private l2Api: L2ApiService,
    @Inject(SERVICES_POPUP_ACTION) private openServicesPopupAction: () => void
  ) {}

  ngOnInit(): void {
    this.isServicesPage = this.router.url.includes('/services/');
    this.otherNetworks$ = this.chainApi.chain$().pipe(
      map(c => (c?.networks ?? []).filter(n => n.id !== (c?.network ?? CHAIN_NETWORK) && !!n.explorer)),
    );

    if (this.l2) {
      this.l2Nav$ = this.l2Api.features$.pipe(map(f => l2FeatureNav(f)));
      this.chainLinks$ = this.chainApi.chain$().pipe(map(chainLinks));
    }

    this.env = this.stateService.env;
    this.backendInfo$ = this.stateService.backendInfo$;
    this.servicesBackendInfo$ = this.stateService.servicesBackendInfo$;
    this.urlLanguage = this.languageService.getLanguageForUrl();
    this.navigationService.subnetPaths.subscribe((paths) => {
      this.networkPaths = paths;
    });
    this.enterpriseInfo$ = this.enterpriseService.info$.subscribe(info => {
      this.enterpriseInfo = info;
    });
    this.network$ = merge(of(''), this.stateService.networkChanged$).pipe(
      tap((network: string) => {
        return network;
      })
    );
    this.network$.pipe(takeUntil(this.destroy$)).subscribe((network) => {
      this.currentNetwork = network;
    });

    this.urlSubscription = this.route.url.subscribe((url) => {
      this.user = this.storageService.getAuth();
      this.cd.markForCheck();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.user) {
      this.user = this.storageService.getAuth();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next(true);
    this.destroy$.complete();
    this.urlSubscription.unsubscribe();
    if (this.enterpriseInfo$) {
      this.enterpriseInfo$.unsubscribe();
    }
  }

  openServicesPopup(): void {
    this.openServicesPopupAction();
  }

  networkLink(network) {
    const thisNetwork = network || 'mainnet';
    if( network === '' || network === 'mainnet' || network === 'testnet' || network === 'testnet4' || network === 'signet' ) {
      return (this.env.BASE_MODULE === 'mempool' ? '' : this.env.MEMPOOL_WEBSITE_URL + this.urlLanguage) + this.networkPaths[thisNetwork] || '/';
    }
    if( network === 'liquid' || network === 'liquidtestnet' ) {
      return (this.env.BASE_MODULE === 'liquid' ? '' : this.env.LIQUID_WEBSITE_URL + this.urlLanguage) + this.networkPaths[thisNetwork] || '/';
    }
  }
}
