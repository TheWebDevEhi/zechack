import { bech32m } from 'bech32';

const UFVK = 'uviewtest1fry3jd07rpz444xl30jyvl73l9nlsxf06ngfh4kakrtx8dcqasx028gffsezrl8axfg8qtwwl7hw6277w77d38xq4qkqg44uvnsy46uss77ggjctn3t232aqfdww2w8d9xyr74uxkxkg0xhudwzw04fht002nk6nh9vfk5v02pcl8ecxhzz7ltwtk9f5nl074xp3n78pr2jq907e2efy7m92y476539726pknkn6sw0hry427txcnfwxg6pv77zsn6lhr3vs3vmtsc4zl0yqgw47n63yvskncy5htnwfdzvdqckwnjuzc00pvmh4kjkx28e3edx8ra23qtzfctn7wre9jhwr3gnltydtzh03etjqkgj99kfv40gj8h3yl8qutlve4pt27cs7eu956phxr3w7vvcsgf4zed0gajz2uznr4jxaxht0zs5ladapuhskvxrczt36k7vxtuvlctlxfzheevjshemtwz82uadjlvyayujn2us5j0s7';

try {
  const decoded = bech32m.decode(UFVK, 1024);
  console.log('HRP:', decoded.prefix);
  const data = Buffer.from(bech32m.fromWords(decoded.words));
  console.log('Total payload byte length:', data.length);

  let offset = 0;
  while (offset < data.length) {
    const typecode = data[offset];
    offset += 1;
    // compact size length
    let len = data[offset];
    offset += 1;

    console.log(`Found Typecode: 0x${typecode.toString(16).padStart(2, '0')}, length: ${len}`);
    if (typecode === 0x00) console.log('  -> P2PKH transparent pubkey');
    if (typecode === 0x02) console.log('  -> Sapling Extended Full Viewing Key');
    if (typecode === 0x03) console.log('  -> Orchard Full Viewing Key');
    offset += len;
  }
} catch (err: any) {
  console.error('Decode error:', err.message);
}
