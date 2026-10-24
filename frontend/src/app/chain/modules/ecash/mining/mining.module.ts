import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NgxEchartsModule } from 'ngx-echarts';
import { SharedModule } from '@app/shared/shared.module';
import { ChainTableComponent, CxCellDirective } from '@app/chain/components/chain-table/chain-table.component';
import { ChainMiningComponent } from './mining.component';

/** eCash mining statistics (/mining), lazy with its charts */
@NgModule({
  declarations: [ChainMiningComponent],
  imports: [
    CommonModule,
    SharedModule,
    ChainTableComponent,
    CxCellDirective,
    RouterModule.forChild([{ path: '', component: ChainMiningComponent }]),
    NgxEchartsModule.forRoot({ echarts: () => import('@app/graphs/echarts').then(m => m.echarts) }),
  ],
})
export class ChainMiningModule {}
