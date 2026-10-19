import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { PROFILE, PROFILES, ChainProfile } from '@app/chain/profiles';

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

  // Chains Explorer: the chain's logo and marks
  profile = PROFILE;
  nameLength = Math.min(370, Math.max(150, PROFILE.name.length * 46));

  markOf(id: string): ChainProfile {
    return PROFILES[id] ?? PROFILE;
  }
}
