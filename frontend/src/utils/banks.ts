export interface VietQrBankOption {
  code: string;
  name: string;
  bin: string;
}

export const VIETQR_BANKS: VietQrBankOption[] = [
  { code: 'VCB', name: 'Vietcombank', bin: '970436' },
  { code: 'TCB', name: 'Techcombank', bin: '970407' },
  { code: 'MB', name: 'MB Bank', bin: '970422' },
  { code: 'ACB', name: 'ACB', bin: '970416' },
  { code: 'BIDV', name: 'BIDV', bin: '970418' },
  { code: 'ICB', name: 'VietinBank', bin: '970415' },
  { code: 'VPB', name: 'VPBank', bin: '970432' },
  { code: 'TPB', name: 'TPBank', bin: '970423' },
  { code: 'STB', name: 'Sacombank', bin: '970403' },
  { code: 'VIB', name: 'VIB', bin: '970441' },
  { code: 'HDB', name: 'HDBank', bin: '970437' },
  { code: 'OCB', name: 'OCB', bin: '970448' },
  { code: 'SHB', name: 'SHB', bin: '970443' },
  { code: 'MSB', name: 'MSB', bin: '970426' },
  { code: 'VBA', name: 'Agribank', bin: '970405' },
  { code: 'EIB', name: 'Eximbank', bin: '970431' },
  { code: 'SEAB', name: 'SeABank', bin: '970440' },
  { code: 'LPB', name: 'LPBank', bin: '970449' },
];
