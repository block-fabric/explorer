import { NgModule } from '@angular/core';
import { Routes, RouterModule, UrlSegment } from '@angular/router';
import { AppPreloadingStrategy } from '@app/app.preloading-strategy';
import { BlockViewComponent } from '@components/block-view/block-view.component';
import { EightBlocksComponent } from '@components/eight-blocks/eight-blocks.component';
import { MempoolBlockViewComponent } from '@components/mempool-block-view/mempool-block-view.component';
import { ClockComponent } from '@components/clock/clock.component';
import { StatusViewComponent } from '@components/status-view/status-view.component';
import { AddressGroupComponent } from '@components/address-group/address-group.component';
import { TrackerGuard } from '@app/route-guards';
import { L2_FULL, L2_LEAN, NODE_SIDECHAIN } from '@app/chain/profiles';

const browserWindow = window as typeof window & { __env?: any };
const browserWindowEnv = browserWindow.__env || {};

const testnetRoutes: Routes = browserWindowEnv.TESTNET_ENABLED ? [
  {
    path: 'testnet',
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
        data: { preload: true },
      },
      {
        path: '',
        loadChildren: () => import('@app/master-page.module').then(m => m.MasterPageModule),
        data: { preload: true },
      },
      {
        path: 'widget/wallet',
        children: [],
        component: AddressGroupComponent,
        data: {
          networkSpecific: true,
        }
      },
      {
        path: 'status',
        data: { networks: ['bitcoin', 'liquid'] },
        component: StatusViewComponent
      },
      {
        path: '',
        loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
        data: { preload: true },
      },
      {
        path: '**',
        redirectTo: '/testnet'
      },
    ]
  },
] : [];

const testnet4Routes: Routes = browserWindowEnv.TESTNET4_ENABLED ? [
  {
    path: 'testnet4',
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
        data: { preload: true },
      },
      {
        path: '',
        loadChildren: () => import('@app/master-page.module').then(m => m.MasterPageModule),
        data: { preload: true },
      },
      {
        path: 'wallet',
        children: [],
        component: AddressGroupComponent,
        data: {
          networkSpecific: true,
        }
      },
      {
        path: 'status',
        data: { networks: ['bitcoin', 'liquid'] },
        component: StatusViewComponent
      },
      {
        path: '',
        loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
        data: { preload: true },
      },
      {
        path: '**',
        redirectTo: '/testnet4'
      },
    ]
  },
] : [];

const signetRoutes: Routes = browserWindowEnv.SIGNET_ENABLED ? [
  {
    path: 'signet',
    children: [
      {
        path: 'mining/blocks',
        redirectTo: 'blocks',
        pathMatch: 'full'
      },
      {
        path: '',
        pathMatch: 'full',
        loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
        data: { preload: true },
      },
      {
        path: '',
        loadChildren: () => import('@app/master-page.module').then(m => m.MasterPageModule),
        data: { preload: true },
      },
      {
        path: 'widget/wallet',
        children: [],
        component: AddressGroupComponent,
        data: {
          networkSpecific: true,
        }
      },
      {
        path: 'status',
        data: { networks: ['bitcoin', 'liquid'] },
        component: StatusViewComponent
      },
      {
        path: '',
        loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
        data: { preload: true },
      },
      {
        path: '**',
        redirectTo: '/signet'
      },
    ]
  },
] : [];

const regtestRoutes: Routes = browserWindowEnv.REGTEST_ENABLED ? [
  {
    path: 'regtest',
    children: [
      {
        path: 'mining/blocks',
        redirectTo: 'blocks',
        pathMatch: 'full'
      },
      {
        path: '',
        pathMatch: 'full',
        loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
        data: { preload: true },
      },
      {
        path: '',
        loadChildren: () => import('@app/master-page.module').then(m => m.MasterPageModule),
        data: { preload: true },
      },
      {
        path: 'widget/wallet',
        children: [],
        component: AddressGroupComponent,
        data: {
          networkSpecific: true,
        }
      },
      {
        path: 'status',
        data: { networks: ['bitcoin', 'liquid'] },
        component: StatusViewComponent
      },
      {
        path: '',
        loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
        data: { preload: true },
      },
      {
        path: '**',
        redirectTo: '/regtest'
      },
    ]
  },
] : [];

let routes: Routes = [
  ...testnetRoutes,
  ...testnet4Routes,
  ...signetRoutes,
  ...regtestRoutes,
  {
    path: '',
    pathMatch: 'full',
    loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
    data: { preload: true },
  },
  {
    path: 'tx',
    canMatch: [TrackerGuard],
    runGuardsAndResolvers: 'always',
    loadChildren: () => import('@components/tracker/tracker.module').then(m => m.TrackerModule),
  },
  {
    path: '',
    loadChildren: () => import('@app/master-page.module').then(m => m.MasterPageModule),
    data: { preload: true },
  },
  {
    path: 'widget/wallet',
    children: [],
    component: AddressGroupComponent,
    data: {
      networkSpecific: true,
    }
  },
  {
    path: 'preview',
    children: [
      {
        path: '',
        loadChildren: () => import('@app/previews.module').then(m => m.PreviewsModule)
      },
      {
        path: 'testnet',
        loadChildren: () => import('@app/previews.module').then(m => m.PreviewsModule)
      },
      {
        path: 'testnet4',
        loadChildren: () => import('@app/previews.module').then(m => m.PreviewsModule)
      },
      {
        path: 'signet',
        loadChildren: () => import('@app/previews.module').then(m => m.PreviewsModule)
      },
      {
        path: 'regtest',
        loadChildren: () => import('@app/previews.module').then(m => m.PreviewsModule)
      },
    ],
  },
  {
    path: 'clock',
    redirectTo: 'clock/mempool/0'
  },
  {
    path: 'clock/:mode',
    redirectTo: 'clock/:mode/0'
  },
  {
    path: 'clock/:mode/:index',
    component: ClockComponent,
  },
  {
    path: 'view/block/:id',
    component: BlockViewComponent,
  },
  {
    path: 'view/mempool-block/:index',
    component: MempoolBlockViewComponent,
  },
  {
    path: 'view/blocks',
    component: EightBlocksComponent,
  },
  {
    path: 'status',
    data: { networks: ['bitcoin', 'liquid'] },
    component: StatusViewComponent
  },
  {
    path: '',
    loadChildren: () => import('@app/bitcoin-graphs.module').then(m => m.BitcoinGraphsModule),
    data: { preload: true },
  },
];

const liquidTestnetRoutes: Routes = browserWindowEnv.LIQUID_TESTNET_ENABLED ? [
  {
    path: 'testnet',
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadChildren: () => import('@app/liquid/liquid-graphs.module').then(m => m.LiquidGraphsModule),
        data: { preload: true },
      },
      {
        path: '',
        loadChildren: () => import ('@app/liquid/liquid-master-page.module').then(m => m.LiquidMasterPageModule),
        data: { preload: true },
      },
      {
        path: 'widget/wallet',
        children: [],
        component: AddressGroupComponent,
        data: {
          networkSpecific: true,
        }
      },
      {
        path: 'status',
        data: { networks: ['bitcoin', 'liquid'] },
        component: StatusViewComponent
      },
      {
        path: '',
        loadChildren: () => import('@app/liquid/liquid-graphs.module').then(m => m.LiquidGraphsModule),
        data: { preload: true },
      },
      {
        path: '**',
        redirectTo: '/testnet'
      },
    ]
  },
] : [];

if (browserWindowEnv && browserWindowEnv.BASE_MODULE === 'liquid') {
  routes = [
    ...liquidTestnetRoutes,
    {
      path: '',
      pathMatch: 'full',
      loadChildren: () => import('@app/liquid/liquid-graphs.module').then(m => m.LiquidGraphsModule),
      data: { preload: true },
    },
    {
      path: '',
      loadChildren: () => import ('@app/liquid/liquid-master-page.module').then(m => m.LiquidMasterPageModule),
      data: { preload: true },
    },
    {
      path: 'widget/wallet',
      children: [],
      component: AddressGroupComponent,
      data: {
        networkSpecific: true,
      }
    },
    {
      path: 'preview',
      children: [
        {
          path: '',
          loadChildren: () => import('@app/previews.module').then(m => m.PreviewsModule)
        },
        {
          path: 'testnet',
          loadChildren: () => import('@app/previews.module').then(m => m.PreviewsModule)
        },
      ],
    },
    {
      path: 'status',
      data: { networks: ['bitcoin', 'liquid']},
      component: StatusViewComponent
    },
    {
      path: '',
      loadChildren: () => import('@app/liquid/liquid-graphs.module').then(m => m.LiquidGraphsModule),
      data: { preload: true },
    },
  ];
}

// eCash Explorer: a sidechain explorer (PROFILE.kind 'l2') on upstream's UI (CHAIN_UI 'full', chain/profiles.ts) keeps
// upstream's routes (its sidechain pages are in master-page.module.ts), but not the pages of what a sidechain has not:
// proof of work (mining, pools, hashrate), the accelerator, lightning, the price, the eCash drivechain cockpit
const L2_NOT_HERE = /^(mining|acceleration|lightning|stratum|drivechain|graphs\/(mining|acceleration|lightning|price))(\/|$)/;
// (a node sidechain, Flush or FreeBank, likewise: no proof of work of its own; its drivechain page is /peg)
if (L2_FULL || NODE_SIDECHAIN) {
  routes = [
    {
      matcher: (segments: UrlSegment[]) => L2_NOT_HERE.test(segments.map(s => s.path).join('/'))
        ? { consumed: segments } : null,
      redirectTo: (r) => r.url.map(s => s.path).join('/').startsWith('drivechain') ? (NODE_SIDECHAIN ? '/peg' : '/bmm') : '/',
    },
    ...routes,
  ];
}

// eCash Explorer: a sidechain explorer on the lean page set (CHAIN_UI 'lean') has its own pages (chain/l2/), on its
// own API (/api/v1/chain, /api/v1/l2/*): none of upstream's routes, so none of upstream's pages, websocket or APIs
if (L2_LEAN) {
  routes = [
    {
      path: '',
      loadChildren: () => import('@app/chain/l2/l2.routes').then(m => m.L2_ROUTES),
    },
  ];
}

if (!window['isMempoolSpaceBuild']) {
  routes.push({
    path: '**',
    redirectTo: ''
  });
}

@NgModule({
  imports: [RouterModule.forRoot(routes, {
    initialNavigation: 'enabledBlocking',
    scrollPositionRestoration: 'disabled',
    anchorScrolling: 'disabled',
    preloadingStrategy: AppPreloadingStrategy
  })],
})
export class AppRoutingModule { }
