// Minimal ambient types for the Web Bluetooth API (not shipped in lib.dom.d.ts).
// Scoped to the surface area Piano Buddy uses for BLE MIDI.

interface BluetoothCharacteristicProperties {
  broadcast: boolean;
  read: boolean;
  writeWithoutResponse: boolean;
  write: boolean;
  notify: boolean;
  indicate: boolean;
  authenticatedSignedWrites: boolean;
  reliableWrite: boolean;
  writableAuxiliaries: boolean;
}

interface BluetoothLEScanFilter {
  name?: string;
  namePrefix?: string;
  services?: string[];
}

interface RequestDeviceOptions {
  filters?: BluetoothLEScanFilter[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  uuid: string;
  service: BluetoothRemoteGATTService;
  properties: BluetoothCharacteristicProperties;
  value?: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTService {
  uuid: string;
  device: BluetoothDevice;
  isPrimary: boolean;
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics(uuid?: string): Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  device: BluetoothDevice;
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
  getPrimaryServices(uuid?: string): Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface Bluetooth {
  getAvailability(): Promise<boolean>;
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
}

interface Navigator {
  bluetooth?: Bluetooth;
}
