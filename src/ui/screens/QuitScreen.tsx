import { useRef } from 'react';
import { useAppStore } from '../../state/appStore';
import { Button } from '../components';
import { useArrowNavigation, useEscapeToMenu } from '../hooks';
import { ArrowLeftIcon, IcebergMark } from '../icons';

export function QuitScreen() {
  const goTo = useAppStore((s) => s.goTo);
  const ref = useRef<HTMLDivElement>(null);
  useArrowNavigation(ref);
  useEscapeToMenu();
  return (
    <main className="screen screen--quit" aria-labelledby="quit-title">
      <div className="quit">
        <IcebergMark size={72} />
        <h1 className="screen-title" id="quit-title">
          Thanks for playing — you can close this tab now.
        </h1>
        <p className="standfirst">Your progress and settings are saved in this browser.</p>
        <div ref={ref} className="quit__actions">
          <Button icon={<ArrowLeftIcon />} onClick={() => goTo('mainMenu')}>
            Return to Menu
          </Button>
        </div>
      </div>
    </main>
  );
}
