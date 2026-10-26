import { Modal } from '../../components/Modal';
import { BranchesView } from './BranchesView';

/** Branches are something you do and leave, not a place to stay: they open over the work instead of replacing it. */
export function BranchesModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title="Branches" onClose={onClose} className="branchesmodal">
      <div className="branchesmodal__body">
        <BranchesView />
      </div>
    </Modal>
  );
}
