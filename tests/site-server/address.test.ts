import { describe, expect, it } from 'vitest';
import { clientAddress } from '../../site/server/src/address.mjs';

describe('the address a request came from', () => {
  it('is the last one of X-Forwarded-For: the one the web server in front wrote itself', () => {
    expect(clientAddress('203.0.113.7')).toBe('203.0.113.7');
    // whatever a sender put into the header itself stands before it and is not believed
    expect(clientAddress('10.0.0.1, 198.51.100.4, 203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddress('127.0.0.1,203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddress('  203.0.113.7  ')).toBe('203.0.113.7');
    // several headers of the name: Node hands them over as one list, or as an array
    expect(clientAddress(['1.1.1.1', '2.2.2.2, 203.0.113.7'])).toBe('203.0.113.7');
  });

  it('is nothing when the header is missing or its last entry is not an address', () => {
    for (const header of [undefined, '', ' ', 'unknown', '203.0.113.7, evil', '203.0.113.7,', '999.1.1.1', '1.2.3', '203.0.113.7:8080', '<script>', 'localhost', []]) {
      expect(clientAddress(header), String(header)).toBe('');
    }
  });

  it('takes an IPv6 address by its network: the 64 bits a provider gives one customer', () => {
    expect(clientAddress('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(clientAddress('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64');
    expect(clientAddress('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(clientAddress('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(clientAddress('::1')).toBe('0:0:0:0::/64');
    expect(clientAddress('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(clientAddress('2001:db8:1:2::192.0.2.1')).toBe('2001:db8:1:2::/64');
  });

  it('takes an IPv4 address written as IPv6 for the IPv4 address it is', () => {
    expect(clientAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddress('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(clientAddress('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });
});
