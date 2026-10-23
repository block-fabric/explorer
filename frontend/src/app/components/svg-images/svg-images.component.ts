import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { PROFILE, PROFILES, SIDECHAIN_MARK, SIDECHAIN_MARKS, ChainProfile } from '@app/chain/profiles';
import { ECASH_GOLD, ECASH_MARK_PATHS, ECASH_MARK_VIEWBOX } from '@app/chain/marks';

@Component({
  selector: 'app-svg-images',
  templateUrl: './svg-images.component.html',
  styleUrls: ['./svg-images.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SvgImagesComponent {
  randomId = Math.floor(Math.random() * 10000);
  @Input() name: string;
  @Input() class: string;
  @Input() style: string;
  @Input() width: string;
  @Input() height: string;
  @Input() viewBox: string;
  @Input() fill: string;

  // eCash Explorer: the chain's logo and marks
  profile = PROFILE;
  nameLength = Math.min(370, Math.max(150, PROFILE.name.length * 46));
  ecashPaths = ECASH_MARK_PATHS;
  ecashViewBox = ECASH_MARK_VIEWBOX;
  ecashGold = ECASH_GOLD;
  /** a sidechain explorer's logo: eCash's mark, then the sidechain's, then its name (the logo widens by one mark) */
  sidechainLogo = PROFILE.kind === 'l2' || PROFILE.kind === 'flush';
  logoViewBox = this.sidechainLogo ? '0 0 612 126' : '0 0 500 126';

  isEcash(id: string | undefined): boolean {
    return (id || PROFILE.id) === 'ecash';
  }

  markOf(id: string): Pick<ChainProfile, 'mark' | 'markRects'> {
    return id === 'sidechain' ? SIDECHAIN_MARK : PROFILES[id] ?? SIDECHAIN_MARKS[id] ?? PROFILE;
  }
}
