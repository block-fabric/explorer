import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NgxEchartsModule } from 'ngx-echarts';
import { SharedModule } from '@app/shared/shared.module';
import { ChainTableComponent, CxCellDirective } from '@app/chain/components/chain-table/chain-table.component';
import { ChainNodesComponent } from './nodes.component';
import { NodesGlobeComponent } from './nodes-globe.component';

/** a chain's reachable nodes (/nodes), lazy with its chart and map */
@NgModule({
  declarations: [ChainNodesComponent],
  imports: [
    CommonModule,
    SharedModule,
    ChainTableComponent,
    CxCellDirective,
    NodesGlobeComponent,
    RouterModule.forChild([{ path: '', component: ChainNodesComponent }]),
    NgxEchartsModule.forRoot({ echarts: () => import('@app/graphs/echarts').then(m => m.echarts) }),
  ],
})
export class ChainNodesModule {}
