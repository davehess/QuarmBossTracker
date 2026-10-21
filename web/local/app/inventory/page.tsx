import LocalInventory from './LocalInventory';

export const metadata = {
  title: 'My inventory · On this PC',
  description: 'Every item across your characters and where it sits, built from the inventory files on this PC.',
};

export default function InventoryPage() {
  return <LocalInventory />;
}
