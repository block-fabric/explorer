import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NgxEchartsModule } from 'ngx-echarts';
import { SharedModule } from '@app/shared/shared.module';
import { NodesGlobeComponent } from '@app/chain/nodes/nodes-globe.component';
import { ChainConsoleComponent } from './console.component';

/** the console (/console, eCash mainnet's explorer), lazy with its chart and globe */
@NgModule({
  declarations: [ChainConsoleComponent],
  imports: [
    CommonModule,
    SharedModule,
    NodesGlobeComponent,
    RouterModule.forChild([{ path: '', component: ChainConsoleComponent }]),
    NgxEchartsModule.forRoot({ echarts: () => import('@app/graphs/echarts').then(m => m.echarts) }),
  ],
})
export class ChainConsoleModule {}
