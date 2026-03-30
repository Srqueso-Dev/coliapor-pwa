import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RecolectorComponent } from './recolector.component';

describe('RecolectorComponent', () => {
  let component: RecolectorComponent;
  let fixture: ComponentFixture<RecolectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecolectorComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(RecolectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
