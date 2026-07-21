use lila_openingexplorer::{
  db::{ Database, DbOpt },
  model::{ KeyPrefix, MastersEntry, Stats, write_uint, RawUciMove, GameId },
};
use clap::Parser;
use std::fs::File;
use std::io::{Write, Seek, SeekFrom};
use bytes::{Buf, BufMut};
use std::time::{SystemTime, UNIX_EPOCH};

fn main() -> std::io::Result<()> {
  const MAGIC: &[u8; 4] = b"FCOE";
  const FORMAT_VERSION: u16 = 1;
  let revision_id = generate_revision_id();

  let opt = DbOpt::parse();
  let db = Database::open(opt).expect("db");
  let masters_db = db.masters();
  let mut record_count = 0;
  let mut pos_count = 0;

  let mut file = File::create("masters.oe")?;
  file.write_all(MAGIC)?;
  file.write_all(&FORMAT_VERSION.to_le_bytes())?;
  file.write_all(&revision_id.to_le_bytes())?;

  // Reserve space for num_entries
  let num_entries_pos = file.stream_position()?;
  file.write_all(&0u32.to_le_bytes())?;

  let mut written_count: u32 = 0;

  const FLUSH_SIZE: usize = 8 * 1024 * 1024; // 8 MB
  let mut buf = Vec::with_capacity(FLUSH_SIZE);

  let mut curr_prefix: Option<[u8; KeyPrefix::SIZE]> = None;
  let mut curr_entry: Option<MastersEntry> = None;

  for (key, value) in masters_db.iter() {
    //println!("key = {:02x?}", key);
    //println!("value length = {}", value.len());

    let prefix: [u8; KeyPrefix::SIZE] =
      key[..KeyPrefix::SIZE].try_into().unwrap();

    let year = u16::from_be_bytes(key[KeyPrefix::SIZE..KeyPrefix::SIZE + 2].try_into().unwrap());

    if curr_prefix != Some(prefix) {
      if let Some(entry) = curr_entry.take() {
        write_pos(curr_prefix.as_ref().unwrap(), &entry, &mut buf, &mut pos_count, &mut written_count);
        if buf.len() >= FLUSH_SIZE {
          file.write_all(&buf)?;
          buf.clear();
        }    
      }

      curr_entry = Some(MastersEntry::default());
      curr_prefix = Some(prefix);
    }

    if let Some(entry) = curr_entry.as_mut() {
      let mut value = &value[..];
      extend_entry_from_reader(entry, &mut value, year);
    }

    record_count += 1;
  }

  // Don't forget the last entry
  if let (Some(prefix), Some(entry)) = (curr_prefix.as_ref(), curr_entry) {
    write_pos(prefix, &entry, &mut buf, &mut pos_count, &mut written_count);
  }

  if !buf.is_empty() {
    file.write_all(&buf)?;
  }

  // Go back and fill in num_entries
  file.seek(SeekFrom::Start(num_entries_pos))?;
  file.write_all(&written_count.to_le_bytes())?;

  println!("Entries: {}", record_count);
  println!("Positions: {}", pos_count);
  println!("Written: {}", written_count);

  Ok(())
}

fn write_pos(prefix: &[u8; KeyPrefix::SIZE], entry: &MastersEntry, buf: &mut Vec<u8>, pos_count: &mut usize, written_count: &mut u32) {
  *pos_count += 1;

  let mut total = Stats::default();
  for group in entry.groups.values() {
    if group.stats.total() >= 2 {
      total += &group.stats;
    }
  }
  if total.total() == 0 {
    return;
  }
  
  buf.extend_from_slice(prefix);

  let num_moves = entry.groups
    .values()
    .filter(|group| group.stats.total() >= 2)
    .count() as u8;

  buf.put_u8(num_moves);

  for (uci, group) in &entry.groups {
    if group.stats.total() >= 2 {
      uci.write(buf);
      write_uint(buf, group.last_year as u64);
      write_stats(&group.stats, buf);
    }
  }

  *written_count += 1;
    
  //println!("{:#?}", entry);
}

fn generate_revision_id() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .expect("System time is before UNIX epoch")
    .as_millis() as u64
}

fn write_stats<B: BufMut>(stats: &Stats, buf: &mut B) {
  //write_uint(buf, stats.rating_sum);

  let white: u64 = stats.white();
  let draws: u64 = stats.draws();
  let black: u64 = stats.black();

  let compressed = match(white, draws, black) {
    (2, 0, 0) => Some(0),
    (0, 2, 0) => Some(1),
    (0, 0, 2) => Some(2),
    (1, 1, 0) => Some(3),
    (1, 0, 1) => Some(4),
    (0, 1, 1) => Some(5),
    _ => None,
  };

  if let Some(value) = compressed {
    write_uint(buf, value);
  } else {
    write_uint(buf, white + 6);
    write_uint(buf, draws);
    write_uint(buf, black);
  }
}

fn extend_entry_from_reader<B: Buf>(entry: &mut MastersEntry, buf: &mut B, year: u16) {
  while buf.has_remaining() {
    let uci = RawUciMove::read(buf);
    let group = entry.groups.entry(uci).or_default();
    group.stats += &Stats::read(buf);
    let num_games = usize::from(buf.get_u8());
    group
      .games
      .extend((0..num_games).map(|_| (buf.get_u16_le(), GameId::read(buf))));
    group.last_year = year;
  }
}