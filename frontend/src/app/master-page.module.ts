import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { MasterPageComponent } from '@components/master-page/master-page.component';
import { SharedModule } from '@app/shared/shared.module';

import { StartComponent } from '@components/start/start.component';
import { PushTransactionComponent } from '@components/push-transaction/push-transaction.component';
import { TestTransactionsComponent } from '@components/test-transactions/test-transactions.component';
import { BlocksList } from '@components/blocks-list/blocks-list.component';
import { RbfList } from '@components/rbf-list/rbf-list.component';
import { RecentTransactionsList } from '@components/recent-transactions-list/recent-transactions-list.component';
import { StaleList } from '@components/stale-list/stale-list.component';
import { StratumList } from '@components/stratum/stratum-list/stratum-list.component';
import { ServerHealthComponent } from '@components/server-health/server-health.component';
import { ServerStatusComponent } from '@components/server-health/server-status.component';
import { FaucetComponent } from '@components/faucet/faucet.component';
import { SimpleProofWidgetComponent } from '@components/simpleproof-widget/simpleproof-widget.component';
import { SimpleProofCuboWidgetComponent } from '@components/simpleproof-widget/simpleproof-cubo-widget.component';

const browserWindow = window || {};
// @ts-ignore
const browserWindowEnv = browserWindow.__env || {};

import { L2_FULL, MODULE } from '@app/chain/profiles';
import { L2_FEATURE_PAGES } from '@app/chain/l2/l2-nav';

/**
 * eCash Explorer: a sidechain explorer on upstream's UI (CHAIN_UI 'full'): its own pages, from the lean page set
 * (chain/l2/pages): the drivechain page (BMM on eCash, with deposits and withdrawals; /deposits and /withdrawals open it
 * at that section), and its feature pages (the module's own first)
 */
const featureList = () => import('@app/chain/l2/pages/feature.page').then(m => m.L2FeaturePageComponent);
const featureItem = () => import('@app/chain/l2/pages/feature.page').then(m => m.L2FeatureItemPage);
const L2_FULL_ROUTES: Routes = L2_FULL ? [
  { path: 'bmm', loadComponent: () => import('@app/chain/l2/pages/bmm.page').then(m => m.L2BmmPage) },
  { path: 'deposits', data: { peg: 'deposits' }, loadComponent: () => import('@app/chain/l2/pages/bmm.page').then(m => m.L2BmmPage) },
  { path: 'withdrawals', data: { peg: 'withdrawals' }, loadComponent: () => import('@app/chain/l2/pages/bmm.page').then(m => m.L2BmmPage) },
  ...L2_FEATURE_PAGES
    .filter(p => !(MODULE.routes ?? []).some(r => r.path === p.path))
    .flatMap(p => [
      { path: p.path, data: { page: p.path }, loadComponent: featureList },
      ...(p.detail && !(MODULE.routes ?? []).some(r => r.path === p.path + '/:id')
        ? [{ path: p.path + '/:id', data: { page: p.path }, loadComponent: featureItem }] : []),
    ]),
] : [];
import { ChainSwitcherComponent } from '@app/chain/components/chain-switcher/chain-switcher.component';

const routes: Routes = [
  {
    path: '',
    component: MasterPageComponent,
    children: [
      {
        path: 'mining/blocks',
        redirectTo: 'blocks',
        pathMatch: 'full'
      },
      {
        path: 'tx/push',
        component: PushTransactionComponent,
      },
      {
        path: 'pushtx',
        component: PushTransactionComponent,
      },
      {
        path: 'tx/test',
        component: TestTransactionsComponent,
      },
      {
        path: 'about',
        // eCash Explorer: our own About page (upstream's is mempool.space's: its team, sponsors, services)
        loadComponent: () => import('@app/chain/pages/about.page').then(m => m.ChainAboutPage),
      },
      {
        path: 'blocks/stale',
        component: StaleList,
      },
      {
        path: 'blocks/:page',
        component: BlocksList,
      },
      {
        path: 'blocks',
        redirectTo: 'blocks/1',
      },
      {
        path: 'rbf',
        component: RbfList,
      },
      // eCash Explorer: the drivechain cockpit
      {
        path: 'drivechain',
        loadChildren: () => import('@app/chain/pages/cockpit/cockpit.module').then(m => m.ChainCockpitModule),
      },
      // eCash Explorer: the pages of the chain module (chain/modules/<id>), and a sidechain's own (above)
      ...(MODULE.routes ?? []),
      ...L2_FULL_ROUTES,
      {
        path: 'txs',
        component: RecentTransactionsList,
      },
      ...(browserWindowEnv.STRATUM_ENABLED ? [{
        path: 'stratum',
        component: StartComponent,
        children: [
          {
            path: '',
            component: StratumList,
          }
        ]
      }] : []),
      {
        path: 'terms-of-service',
        loadChildren: () => import('@components/terms-of-service/terms-of-service.module').then(m => m.TermsOfServiceModule),
      },
      {
        path: 'privacy-policy',
        loadChildren: () => import('@components/privacy-policy/privacy-policy.module').then(m => m.PrivacyPolicyModule),
      },
      {
        path: 'trademark-policy',
        loadChildren: () => import('@components/trademark-policy/trademark-policy.module').then(m => m.TrademarkModule),
      },
      {
        path: 'tx',
        component: StartComponent,
        data: { preload: true, networkSpecific: true },
        loadChildren: () => import('@components/transaction/transaction.module').then(m => m.TransactionModule),
      },
      {
        path: 'block',
        component: StartComponent,
        data: { preload: true, networkSpecific: true },
        loadChildren: () => import('@components/block/block.module').then(m => m.BlockModule),
      },
      {
        path: 'docs',
        loadChildren: () => import('@app/docs/docs.module').then(m => m.DocsModule),
        data: { preload: true },
      },
      {
        path: 'api',
        loadChildren: () => import('@app/docs/docs.module').then(m => m.DocsModule)
      },
      {
        path: 'lightning',
        loadChildren: () => import('@app/lightning/lightning.module').then(m => m.LightningModule),
        data: { preload: browserWindowEnv && browserWindowEnv.LIGHTNING === true, networks: ['bitcoin'] },
      }
    ],
  }
];

if (window['__env']?.OFFICIAL_MEMPOOL_SPACE) {
  routes[0].children.push({
    path: 'monitoring',
    data: { networks: ['bitcoin', 'liquid'] },
    component: ServerHealthComponent
  });
  routes[0].children.push({
    path: 'nodes',
    data: { networks: ['bitcoin', 'liquid'] },
    component: ServerStatusComponent
  });
  if (window['isMempoolSpaceBuild']) {
    routes[0].children.push({
      path: 'faucet',
      canActivate: [(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
        return state.url.startsWith('/testnet4/');
      }],
      component: StartComponent,
      data: { preload: true, networkSpecific: true },
      children: [{
        path: '',
        data: { networks: ['bitcoin'] },
        component: FaucetComponent,
      }]
    });
  }
}

if (window['__env']?.customize?.dashboard?.widgets?.some(w => w.component ==='simpleproof')) {
  routes[0].children.push({
    path: 'sp/verified',
    component: SimpleProofWidgetComponent,
  });
}

if (window['__env']?.customize?.dashboard?.widgets?.some(w => w.component ==='simpleproof_cubo')) {
  routes[0].children.push({
    path: 'sp/cubo',
    component: SimpleProofCuboWidgetComponent,
  });
}

@NgModule({
  imports: [
    RouterModule.forChild(routes)
  ],
  exports: [
    RouterModule
  ]
})
export class MasterPageRoutingModule { }

@NgModule({
  imports: [
    CommonModule,
    MasterPageRoutingModule,
    SharedModule,
    ChainSwitcherComponent,
  ],
  declarations: [
    MasterPageComponent,
  ],
  exports: [
    MasterPageComponent,
  ]
})
export class MasterPageModule { }
