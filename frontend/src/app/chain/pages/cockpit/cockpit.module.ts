import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NgxEchartsModule } from 'ngx-echarts';
import { SharedModule } from '@app/shared/shared.module';
import { ChainTableComponent, CxCellDirective } from '@app/chain/components/chain-table/chain-table.component';
import { ChainCockpitComponent } from './cockpit.component';

/** The drivechain cockpit (/drivechain), lazy with its charts */
@NgModule({
  declarations: [ChainCockpitComponent],
  imports: [
    CommonModule,
    SharedModule,
    ChainTableComponent,
    CxCellDirective,
    RouterModule.forChild([{ path: '', component: ChainCockpitComponent }]),
    NgxEchartsModule.forRoot({ echarts: () => import('@app/graphs/echarts').then(m => m.echarts) }),
  ],
})
export class ChainCockpitModule {}
